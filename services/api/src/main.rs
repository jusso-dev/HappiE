use std::{env, net::SocketAddr, path::PathBuf, time::Duration};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use aws_config::{BehaviorVersion, Region};
use aws_credential_types::Credentials;
use aws_sdk_s3::{
    config::Builder as S3ConfigBuilder, presigning::PresigningConfig, primitives::ByteStream,
    Client as S3Client,
};
use axum::{
    async_trait,
    extract::{Multipart, Path, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, Column, PgPool, Row};
use tokio::{fs, process::Command};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    jwt_secret: String,
    refresh_secret: String,
    worker_token: String,
    s3: Storage,
}

#[derive(Clone)]
struct Storage {
    client: S3Client,
    bucket: String,
    public_base_url: String,
}

#[derive(Debug, Serialize)]
struct ApiError {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::BAD_REQUEST, Json(self)).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
struct Claims {
    sub: Uuid,
    role: String,
    exp: usize,
}

#[derive(Debug, Clone)]
struct AuthedUser {
    id: Uuid,
    role: String,
}

#[async_trait]
impl axum::extract::FromRequestParts<AppState> for AuthedUser {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| unauthorized("missing bearer token"))?;
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| unauthorized("invalid token"))?;
        Ok(Self {
            id: data.claims.sub,
            role: data.claims.role,
        })
    }
}

fn unauthorized(msg: &str) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiError {
            error: msg.to_string(),
        }),
    )
}

fn err(msg: impl Into<String>) -> ApiError {
    ApiError { error: msg.into() }
}

fn require_owner(user: &AuthedUser) -> ApiResult<()> {
    if user.role == "owner" {
        Ok(())
    } else {
        Err(err("owner access required"))
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        health,
        login,
        refresh,
        me,
        list_children,
        create_child,
        update_child,
        delete_child,
        list_users,
        create_user,
        update_user,
        delete_user,
        list_videos,
        create_video,
        update_video,
        delete_video,
        assign_video,
        unassign_video,
        child_library,
        playback_url,
        download_manifest,
        register_device,
        sync_device,
        watch_progress,
        presign_upload,
        complete_upload,
        youtube_search,
        youtube_url,
        storage_summary,
        get_import,
        cancel_import,
        list_categories,
        create_category,
        update_category,
        delete_category
    ),
    components(schemas(
        LoginRequest,
        TokenResponse,
        UserInput,
        UserUpdateInput,
        ChildInput,
        VideoInput,
        CategoryInput,
        AssignRequest
    ))
)]
struct ApiDoc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = env::var("DATABASE_URL")?;
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../../infra/migrations").run(&db).await?;
    seed_admin(&db).await?;

    validate_runtime_config()?;

    let state = AppState {
        db,
        jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| "dev-access-secret-change-me".into()),
        refresh_secret: env::var("REFRESH_TOKEN_SECRET")
            .unwrap_or_else(|_| "dev-refresh-secret-change-me".into()),
        worker_token: env::var("IMPORT_WORKER_TOKEN").unwrap_or_else(|_| "dev-worker-token".into()),
        s3: build_storage().await?,
    };

    let cors = CorsLayer::new()
        .allow_origin(allowed_origins())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/me", get(me))
        .route("/users", get(list_users).post(create_user))
        .route("/users/:id", put(update_user).delete(delete_user))
        .route("/children", get(list_children).post(create_child))
        .route("/children/:id", put(update_child).delete(delete_child))
        .route("/children/:id/library", get(child_library))
        .route("/videos", get(list_videos).post(create_video))
        .route(
            "/videos/:id",
            get(get_video).put(update_video).delete(delete_video),
        )
        .route("/videos/:id/assign", post(assign_video))
        .route("/videos/:id/assign/:child_id", delete(unassign_video))
        .route("/videos/:id/playback-url", get(playback_url))
        .route("/videos/:id/download-manifest", get(download_manifest))
        .route("/categories", get(list_categories).post(create_category))
        .route(
            "/categories/:id",
            put(update_category).delete(delete_category),
        )
        .route("/devices/register", post(register_device))
        .route("/devices/:id/sync", post(sync_device))
        .route("/watch-progress", post(watch_progress))
        .route("/uploads/presign", post(presign_upload))
        .route("/uploads/complete", post(complete_upload))
        .route("/uploads/direct", post(direct_upload))
        .route("/storage/summary", get(storage_summary))
        .route("/imports/youtube/search", post(youtube_search))
        .route("/imports/youtube/url", post(youtube_url))
        .route("/imports", get(list_imports))
        .route("/imports/:id", get(get_import).delete(delete_import))
        .route("/imports/:id/cancel", post(cancel_import))
        .route("/imports/:id/retry", post(retry_import))
        .route("/worker/imports/next", post(worker_next_import))
        .route("/worker/imports/:id/status", post(worker_update_import))
        .route(
            "/worker/imports/:id/playlist-items",
            post(worker_create_playlist_items),
        )
        .merge(SwaggerUi::new("/docs").url("/openapi.json", ApiDoc::openapi()))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    tracing::info!("happie api listening on {addr}");
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

fn validate_runtime_config() -> anyhow::Result<()> {
    if env::var("APP_ENV").unwrap_or_default() != "production" {
        return Ok(());
    }

    let unsafe_values = [
        ("JWT_SECRET", "dev-access-secret-change-me"),
        ("REFRESH_TOKEN_SECRET", "dev-refresh-secret-change-me"),
        ("IMPORT_WORKER_TOKEN", "dev-worker-token"),
        ("ADMIN_BOOTSTRAP_PASSWORD", "ChangeMe123!"),
    ];

    for (name, unsafe_value) in unsafe_values {
        let value = env::var(name).unwrap_or_default();
        if value.is_empty() || value == unsafe_value || value.len() < 24 {
            anyhow::bail!(
                "{name} must be set to a strong non-default value when APP_ENV=production"
            );
        }
    }

    Ok(())
}

fn allowed_origins() -> Vec<HeaderValue> {
    env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:5500".into())
        .split(',')
        .filter_map(|origin| {
            let trimmed = origin.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse().ok()
            }
        })
        .collect()
}

async fn build_storage() -> anyhow::Result<Storage> {
    let endpoint = env::var("R2_ENDPOINT").unwrap_or_else(|_| "http://minio:9000".into());
    let bucket = env::var("R2_BUCKET").unwrap_or_else(|_| "happie".into());
    let access_key = env::var("R2_ACCESS_KEY_ID").unwrap_or_else(|_| "minioadmin".into());
    let secret = env::var("R2_SECRET_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
    let creds = Credentials::new(access_key, secret, None, None, "happie-env");
    let base = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new("auto"))
        .credentials_provider(creds)
        .load()
        .await;
    let config = S3ConfigBuilder::from(&base)
        .endpoint_url(endpoint.clone())
        .force_path_style(true)
        .build();
    Ok(Storage {
        client: S3Client::from_conf(config),
        bucket,
        public_base_url: endpoint,
    })
}

async fn seed_admin(db: &PgPool) -> anyhow::Result<()> {
    let email = env::var("ADMIN_BOOTSTRAP_EMAIL").unwrap_or_else(|_| "owner@happie.local".into());
    let password = env::var("ADMIN_BOOTSTRAP_PASSWORD").unwrap_or_else(|_| "ChangeMe123!".into());
    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(db)
        .await?;
    if exists.is_none() {
        let hash = hash_password(&password)?;
        sqlx::query("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'owner')")
            .bind(email)
            .bind(hash)
            .execute(db)
            .await?;
    }
    Ok(())
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

fn issue_access(state: &AppState, user_id: Uuid, role: &str) -> ApiResult<String> {
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        exp: (Utc::now() + ChronoDuration::minutes(30)).timestamp() as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|_| err("failed to sign token"))
}

fn random_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

fn token_hash(secret: &str, token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn audit(
    db: &PgPool,
    actor: Option<Uuid>,
    action: &str,
    entity: &str,
    entity_id: Option<Uuid>,
    metadata: Value,
) {
    let _ = sqlx::query(
        "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(actor)
    .bind(action)
    .bind(entity)
    .bind(entity_id)
    .bind(metadata)
    .execute(db)
    .await;
}

#[utoipa::path(get, path = "/health")]
async fn health() -> Json<Value> {
    Json(json!({"ok": true, "service": "happie-api"}))
}

#[derive(Deserialize, ToSchema)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Serialize, ToSchema)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
}

#[utoipa::path(post, path = "/auth/login", request_body = LoginRequest)]
async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<TokenResponse>> {
    let row =
        sqlx::query("SELECT id, password_hash, role FROM users WHERE lower(email) = lower($1)")
            .bind(req.email.trim())
            .fetch_optional(&state.db)
            .await
            .map_err(|_| err("login failed"))?
            .ok_or_else(|| err("invalid credentials"))?;
    let id: Uuid = row.get("id");
    let password_hash: String = row.get("password_hash");
    let role: String = row.get("role");
    if !verify_password(&req.password, &password_hash) {
        return Err(err("invalid credentials"));
    }
    let access_token = issue_access(&state, id, &role)?;
    let refresh_token = random_token();
    let hash = token_hash(&state.refresh_secret, &refresh_token);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)")
        .bind(id)
        .bind(hash)
        .bind(Utc::now() + ChronoDuration::days(30))
        .execute(&state.db)
        .await
        .map_err(|_| err("failed to persist refresh token"))?;
    audit(&state.db, Some(id), "login", "user", Some(id), json!({})).await;
    Ok(Json(TokenResponse {
        access_token,
        refresh_token,
    }))
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

#[utoipa::path(post, path = "/auth/refresh")]
async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> ApiResult<Json<TokenResponse>> {
    let hash = token_hash(&state.refresh_secret, &req.refresh_token);
    let row = sqlx::query(
        "SELECT rt.user_id, u.role FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()",
    )
    .bind(hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| err("refresh failed"))?
    .ok_or_else(|| err("invalid refresh token"))?;
    let user_id: Uuid = row.get("user_id");
    let role: String = row.get("role");
    let refresh_token = random_token();
    let new_hash = token_hash(&state.refresh_secret, &refresh_token);
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1")
        .bind(token_hash(&state.refresh_secret, &req.refresh_token))
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)")
        .bind(user_id)
        .bind(new_hash)
        .bind(Utc::now() + ChronoDuration::days(30))
        .execute(&state.db)
        .await
        .map_err(|_| err("failed to persist refresh token"))?;
    Ok(Json(TokenResponse {
        access_token: issue_access(&state, user_id, &role)?,
        refresh_token,
    }))
}

#[utoipa::path(get, path = "/me")]
async fn me(State(state): State<AppState>, user: AuthedUser) -> ApiResult<Json<Value>> {
    let row = sqlx::query("SELECT id, email, role, created_at FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("user not found"))?;
    Ok(Json(
        json!({"id": row.get::<Uuid,_>("id"), "email": row.get::<String,_>("email"), "role": row.get::<String,_>("role"), "created_at": row.get::<DateTime<Utc>,_>("created_at")}),
    ))
}

#[derive(Deserialize, ToSchema)]
struct UserInput {
    email: String,
    password: String,
    role: String,
}

#[derive(Deserialize, ToSchema)]
struct UserUpdateInput {
    email: String,
    password: Option<String>,
    role: String,
}

fn validate_user_role(role: &str) -> ApiResult<&str> {
    match role {
        "owner" | "admin" | "viewer" => Ok(role),
        _ => Err(err("role must be owner, admin, or viewer")),
    }
}

#[utoipa::path(get, path = "/users")]
async fn list_users(State(state): State<AppState>, user: AuthedUser) -> ApiResult<Json<Value>> {
    require_owner(&user)?;
    rows_json(
        sqlx::query(
            "SELECT id, email, role, created_at, updated_at FROM users ORDER BY created_at",
        )
        .fetch_all(&state.db)
        .await,
    )
}

#[utoipa::path(post, path = "/users", request_body = UserInput)]
async fn create_user(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<UserInput>,
) -> ApiResult<Json<Value>> {
    require_owner(&user)?;
    let email = req.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(err("valid email is required"));
    }
    if req.password.len() < 10 {
        return Err(err("password must be at least 10 characters"));
    }
    let role = validate_user_role(req.role.as_str())?;
    let hash = hash_password(&req.password).map_err(|_| err("failed to hash password"))?;
    let row = sqlx::query("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at, updated_at")
        .bind(email)
        .bind(hash)
        .bind(role)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("email is already in use"))?;
    let id: Uuid = row.get("id");
    audit(
        &state.db,
        Some(user.id),
        "create",
        "user",
        Some(id),
        json!({"role": role}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(put, path = "/users/{id}", request_body = UserUpdateInput)]
async fn update_user(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UserUpdateInput>,
) -> ApiResult<Json<Value>> {
    require_owner(&user)?;
    let email = req.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(err("valid email is required"));
    }
    let role = validate_user_role(req.role.as_str())?;
    if user.id == id && role != "owner" {
        return Err(err("you cannot remove your own owner role"));
    }

    let row = if let Some(password) = req.password.filter(|value| !value.is_empty()) {
        if password.len() < 10 {
            return Err(err("password must be at least 10 characters"));
        }
        let hash = hash_password(&password).map_err(|_| err("failed to hash password"))?;
        sqlx::query("UPDATE users SET email=$1, password_hash=$2, role=$3, updated_at=now() WHERE id=$4 RETURNING id, email, role, created_at, updated_at")
            .bind(email)
            .bind(hash)
            .bind(role)
            .bind(id)
            .fetch_one(&state.db)
            .await
    } else {
        sqlx::query("UPDATE users SET email=$1, role=$2, updated_at=now() WHERE id=$3 RETURNING id, email, role, created_at, updated_at")
            .bind(email)
            .bind(role)
            .bind(id)
            .fetch_one(&state.db)
            .await
    }
    .map_err(|_| err("user not found or email is already in use"))?;
    audit(
        &state.db,
        Some(user.id),
        "edit",
        "user",
        Some(id),
        json!({"role": role}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(delete, path = "/users/{id}")]
async fn delete_user(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    require_owner(&user)?;
    if user.id == id {
        return Err(err("you cannot delete your own account"));
    }
    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| err("delete failed"))?;
    if result.rows_affected() == 0 {
        return Err(err("user not found"));
    }
    audit(
        &state.db,
        Some(user.id),
        "delete",
        "user",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize, ToSchema)]
struct ChildInput {
    name: String,
    avatar_color: Option<String>,
    birth_year: Option<i32>,
    storage_quota_mb: Option<i32>,
}

#[utoipa::path(get, path = "/children")]
async fn list_children(State(state): State<AppState>, _user: AuthedUser) -> ApiResult<Json<Value>> {
    rows_json(
        sqlx::query("SELECT * FROM child_profiles WHERE is_active = true ORDER BY created_at")
            .fetch_all(&state.db)
            .await,
    )
}

#[utoipa::path(post, path = "/children", request_body = ChildInput)]
async fn create_child(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<ChildInput>,
) -> ApiResult<Json<Value>> {
    if req.name.trim().is_empty() {
        return Err(err("child name is required"));
    }
    let row = sqlx::query("INSERT INTO child_profiles (name, avatar_color, birth_year, storage_quota_mb) VALUES ($1,$2,$3,$4) RETURNING *")
        .bind(req.name.trim()).bind(req.avatar_color).bind(req.birth_year).bind(req.storage_quota_mb.unwrap_or(8192))
        .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    let id: Uuid = row.get("id");
    audit(
        &state.db,
        Some(user.id),
        "create",
        "child_profile",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(put, path = "/children/{id}", request_body = ChildInput)]
async fn update_child(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<ChildInput>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("UPDATE child_profiles SET name=$1, avatar_color=$2, birth_year=$3, storage_quota_mb=$4, updated_at=now() WHERE id=$5 RETURNING *")
        .bind(req.name.trim()).bind(req.avatar_color).bind(req.birth_year).bind(req.storage_quota_mb.unwrap_or(8192)).bind(id)
        .fetch_one(&state.db).await.map_err(|_| err("child not found"))?;
    audit(
        &state.db,
        Some(user.id),
        "edit",
        "child_profile",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(delete, path = "/children/{id}")]
async fn delete_child(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    sqlx::query("UPDATE child_profiles SET is_active=false, updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| err("delete failed"))?;
    audit(
        &state.db,
        Some(user.id),
        "delete",
        "child_profile",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize, ToSchema)]
struct CategoryInput {
    name: String,
    color: Option<String>,
}

#[utoipa::path(get, path = "/categories")]
async fn list_categories(
    State(state): State<AppState>,
    _user: AuthedUser,
) -> ApiResult<Json<Value>> {
    rows_json(
        sqlx::query("SELECT * FROM categories ORDER BY name")
            .fetch_all(&state.db)
            .await,
    )
}

#[utoipa::path(post, path = "/categories", request_body = CategoryInput)]
async fn create_category(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<CategoryInput>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("INSERT INTO categories (name, color) VALUES ($1,$2) RETURNING *")
        .bind(req.name.trim())
        .bind(req.color)
        .fetch_one(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    audit(
        &state.db,
        Some(user.id),
        "create",
        "category",
        Some(row.get("id")),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(put, path = "/categories/{id}", request_body = CategoryInput)]
async fn update_category(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CategoryInput>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("UPDATE categories SET name=$1, color=$2 WHERE id=$3 RETURNING *")
        .bind(req.name.trim())
        .bind(req.color)
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("category not found"))?;
    audit(
        &state.db,
        Some(user.id),
        "edit",
        "category",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(delete, path = "/categories/{id}")]
async fn delete_category(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM categories WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| err("delete failed"))?;
    audit(
        &state.db,
        Some(user.id),
        "delete",
        "category",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize, ToSchema)]
struct VideoInput {
    title: String,
    description: Option<String>,
    category_id: Option<Uuid>,
    approved: Option<bool>,
    source_type: Option<String>,
    source_url: Option<String>,
    thumbnail_key: Option<String>,
    status: Option<String>,
}

#[utoipa::path(get, path = "/videos")]
async fn list_videos(State(state): State<AppState>, _user: AuthedUser) -> ApiResult<Json<Value>> {
    let rows = sqlx::query("SELECT v.*, c.name AS category_name, COALESCE(SUM(a.file_size_bytes), 0)::bigint AS storage_bytes FROM videos v LEFT JOIN categories c ON c.id=v.category_id LEFT JOIN video_assets a ON a.video_id=v.id GROUP BY v.id, c.name ORDER BY v.created_at DESC")
        .fetch_all(&state.db).await.map_err(|e| err(e.to_string()))?;
    let mut videos = Vec::new();
    for row in rows {
        videos.push(video_json(&state, &row, false).await?);
    }
    Ok(Json(Value::Array(videos)))
}

async fn get_video(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("SELECT * FROM videos WHERE id=$1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("video not found"))?;
    Ok(Json(video_json(&state, &row, true).await?))
}

#[utoipa::path(post, path = "/videos", request_body = VideoInput)]
async fn create_video(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<VideoInput>,
) -> ApiResult<Json<Value>> {
    if req.title.trim().is_empty() {
        return Err(err("title is required"));
    }
    let row = sqlx::query("INSERT INTO videos (title, description, source_type, source_url, category_id, thumbnail_key, approved, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *")
        .bind(req.title.trim()).bind(req.description.unwrap_or_default()).bind(req.source_type.unwrap_or_else(|| "upload".into()))
        .bind(req.source_url).bind(req.category_id).bind(req.thumbnail_key).bind(req.approved.unwrap_or(false)).bind(req.status.unwrap_or_else(|| "draft".into())).bind(user.id)
        .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    let id: Uuid = row.get("id");
    audit(
        &state.db,
        Some(user.id),
        "create",
        "video",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(put, path = "/videos/{id}", request_body = VideoInput)]
async fn update_video(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<VideoInput>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("UPDATE videos SET title=$1, description=$2, category_id=$3, thumbnail_key=COALESCE($4, thumbnail_key), approved=$5, status=COALESCE($6, status), updated_at=now() WHERE id=$7 RETURNING *")
        .bind(req.title.trim()).bind(req.description.unwrap_or_default()).bind(req.category_id).bind(req.thumbnail_key)
        .bind(req.approved.unwrap_or(false)).bind(req.status).bind(id)
        .fetch_one(&state.db).await.map_err(|_| err("video not found"))?;
    audit(
        &state.db,
        Some(user.id),
        "edit",
        "video",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(delete, path = "/videos/{id}")]
async fn delete_video(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    sqlx::query("UPDATE videos SET status='archived', updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| err("delete failed"))?;
    audit(
        &state.db,
        Some(user.id),
        "delete",
        "video",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize, ToSchema)]
struct AssignRequest {
    child_profile_id: Uuid,
    download_priority: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}

#[utoipa::path(post, path = "/videos/{id}/assign", request_body = AssignRequest)]
async fn assign_video(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<AssignRequest>,
) -> ApiResult<Json<Value>> {
    let priority = req.download_priority.unwrap_or_else(|| "normal".into());
    sqlx::query("INSERT INTO video_assignments (video_id, child_profile_id, download_priority, expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT (video_id, child_profile_id) DO UPDATE SET download_priority=$3, expires_at=$4")
        .bind(id).bind(req.child_profile_id).bind(priority).bind(req.expires_at).execute(&state.db).await.map_err(|e| err(e.to_string()))?;
    audit(
        &state.db,
        Some(user.id),
        "assign",
        "video",
        Some(id),
        json!({"child_profile_id": req.child_profile_id}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[utoipa::path(delete, path = "/videos/{id}/assign/{child_id}")]
async fn unassign_video(
    State(state): State<AppState>,
    user: AuthedUser,
    Path((id, child_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM video_assignments WHERE video_id=$1 AND child_profile_id=$2")
        .bind(id)
        .bind(child_id)
        .execute(&state.db)
        .await
        .map_err(|_| err("unassign failed"))?;
    audit(
        &state.db,
        Some(user.id),
        "unassign",
        "video",
        Some(id),
        json!({"child_profile_id": child_id}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[utoipa::path(get, path = "/children/{id}/library")]
async fn child_library(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    rows_json(sqlx::query("SELECT v.*, va.download_priority, va.expires_at FROM videos v JOIN video_assignments va ON va.video_id=v.id WHERE va.child_profile_id=$1 AND v.approved=true AND v.status='ready' AND (va.expires_at IS NULL OR va.expires_at > now()) ORDER BY v.title")
        .bind(id).fetch_all(&state.db).await)
}

#[utoipa::path(get, path = "/videos/{id}/playback-url")]
async fn playback_url(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("SELECT storage_key FROM video_assets WHERE video_id=$1 AND kind='mp4' ORDER BY version DESC, created_at DESC LIMIT 1")
        .bind(id).fetch_one(&state.db).await.map_err(|_| err("playback asset not found"))?;
    let key: String = row.get("storage_key");
    Ok(Json(
        json!({"url": presigned_get(&state.s3, &key).await?, "expires_in_seconds": 900}),
    ))
}

#[utoipa::path(get, path = "/videos/{id}/download-manifest")]
async fn download_manifest(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let rows = sqlx::query("SELECT * FROM video_assets WHERE video_id=$1 AND kind IN ('mp4','thumbnail') ORDER BY kind, version DESC").bind(id).fetch_all(&state.db).await.map_err(|_| err("assets not found"))?;
    let mut assets = Vec::new();
    for row in rows {
        let key: String = row.get("storage_key");
        assets.push(json!({
            "id": row.get::<Uuid,_>("id"),
            "kind": row.get::<String,_>("kind"),
            "quality": row.get::<Option<String>,_>("quality"),
            "width": row.get::<Option<i32>,_>("width"),
            "height": row.get::<Option<i32>,_>("height"),
            "duration_seconds": row.get::<Option<i32>,_>("duration_seconds"),
            "file_size_bytes": row.get::<Option<i64>,_>("file_size_bytes"),
            "version": row.get::<i32,_>("version"),
            "download_url": presigned_get(&state.s3, &key).await?
        }));
    }
    Ok(Json(
        json!({"video_id": id, "expires_at": Utc::now() + ChronoDuration::minutes(15), "assets": assets}),
    ))
}

#[derive(Deserialize)]
struct DeviceRegister {
    child_profile_id: Option<Uuid>,
    name: String,
    platform: String,
    storage_quota_mb: Option<i32>,
}

#[utoipa::path(post, path = "/devices/register")]
async fn register_device(
    State(state): State<AppState>,
    _user: AuthedUser,
    Json(req): Json<DeviceRegister>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("INSERT INTO devices (child_profile_id, name, platform, storage_quota_mb) VALUES ($1,$2,$3,$4) RETURNING *")
        .bind(req.child_profile_id).bind(req.name).bind(req.platform).bind(req.storage_quota_mb.unwrap_or(8192)).fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(post, path = "/devices/{id}/sync")]
async fn sync_device(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let device = sqlx::query("SELECT * FROM devices WHERE id=$1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("device not found"))?;
    let child_id: Option<Uuid> = device.get("child_profile_id");
    let Some(child_id) = child_id else {
        return Err(err("device has no child profile"));
    };
    sqlx::query("UPDATE devices SET last_sync_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .ok();
    let rows = sqlx::query("SELECT v.id, v.title, v.description, v.thumbnail_key, v.duration_seconds, va.download_priority, va.expires_at FROM videos v JOIN video_assignments va ON va.video_id=v.id WHERE va.child_profile_id=$1 AND v.approved=true AND v.status='ready' AND (va.expires_at IS NULL OR va.expires_at > now())")
        .bind(child_id).fetch_all(&state.db).await.map_err(|_| err("sync failed"))?;
    let mut videos = Vec::new();
    for row in rows {
        let video_id: Uuid = row.get("id");
        let asset_rows = sqlx::query("SELECT * FROM video_assets WHERE video_id=$1 AND kind IN ('mp4','thumbnail') ORDER BY kind, version DESC").bind(video_id).fetch_all(&state.db).await.map_err(|_| err("asset lookup failed"))?;
        let mut assets = Vec::new();
        for asset in asset_rows {
            let key: String = asset.get("storage_key");
            assets.push(json!({
                "id": asset.get::<Uuid,_>("id"),
                "kind": asset.get::<String,_>("kind"),
                "quality": asset.get::<Option<String>,_>("quality"),
                "width": asset.get::<Option<i32>,_>("width"),
                "height": asset.get::<Option<i32>,_>("height"),
                "duration_seconds": asset.get::<Option<i32>,_>("duration_seconds"),
                "file_size_bytes": asset.get::<Option<i64>,_>("file_size_bytes"),
                "version": asset.get::<i32,_>("version"),
                "url": presigned_get(&state.s3, &key).await?
            }));
        }
        videos.push(json!({"id": video_id, "title": row.get::<String,_>("title"), "description": row.get::<String,_>("description"), "duration_seconds": row.get::<Option<i32>,_>("duration_seconds"), "download_priority": row.get::<String,_>("download_priority"), "expires_at": row.get::<Option<DateTime<Utc>>,_>("expires_at"), "assets": assets}));
    }
    Ok(Json(
        json!({"device_id": id, "child_profile_id": child_id, "storage_quota_mb": device.get::<i32,_>("storage_quota_mb"), "expires_at": Utc::now() + ChronoDuration::minutes(15), "videos": videos, "remove": []}),
    ))
}

#[derive(Deserialize)]
struct WatchProgressInput {
    child_profile_id: Uuid,
    video_id: Uuid,
    device_id: Option<Uuid>,
    position_seconds: i32,
    completed: Option<bool>,
}

#[utoipa::path(post, path = "/watch-progress")]
async fn watch_progress(
    State(state): State<AppState>,
    _user: AuthedUser,
    Json(req): Json<WatchProgressInput>,
) -> ApiResult<Json<Value>> {
    sqlx::query("INSERT INTO watch_progress (child_profile_id, video_id, device_id, position_seconds, completed) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (child_profile_id, video_id, device_id) DO UPDATE SET position_seconds=$4, completed=$5, updated_at=now()")
        .bind(req.child_profile_id).bind(req.video_id).bind(req.device_id).bind(req.position_seconds).bind(req.completed.unwrap_or(false)).execute(&state.db).await.map_err(|e| err(e.to_string()))?;
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize)]
struct PresignRequest {
    filename: String,
    content_type: String,
    size_bytes: i64,
}

#[utoipa::path(post, path = "/uploads/presign")]
async fn presign_upload(
    State(_state): State<AppState>,
    _user: AuthedUser,
    Json(_req): Json<PresignRequest>,
) -> ApiResult<Json<Value>> {
    Err(err("presigned raw uploads are disabled; use /uploads/direct so HappiE stores only optimized media"))
}

#[derive(Deserialize)]
struct CompleteUploadRequest {
    title: String,
    description: Option<String>,
    storage_key: String,
    content_type: String,
    size_bytes: i64,
}

#[utoipa::path(post, path = "/uploads/complete")]
async fn complete_upload(
    State(_state): State<AppState>,
    _user: AuthedUser,
    Json(_req): Json<CompleteUploadRequest>,
) -> ApiResult<Json<Value>> {
    Err(err("raw upload completion is disabled; use /uploads/direct so HappiE stores only optimized media"))
}

async fn direct_upload(
    State(state): State<AppState>,
    user: AuthedUser,
    mut multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let mut title = "Untitled upload".to_string();
    let mut description = String::new();
    let mut uploaded: Option<(String, String, i64, String, i64)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| err("invalid multipart upload"))?
    {
        let name = field.name().unwrap_or_default().to_string();
        if name == "title" {
            title = field.text().await.unwrap_or_else(|_| title.clone());
        } else if name == "description" {
            description = field.text().await.unwrap_or_default();
        } else if name == "file" {
            let filename = field.file_name().unwrap_or("upload.mp4").to_string();
            let content_type = field.content_type().unwrap_or("video/mp4").to_string();
            let bytes = field
                .bytes()
                .await
                .map_err(|_| err("failed to read upload"))?;
            validate_video_upload(&content_type, bytes.len() as i64)?;
            uploaded = Some(optimize_uploaded_video(&state, bytes.to_vec(), &filename).await?);
        }
    }
    let Some((mp4_key, thumbnail_key, mp4_size, thumbnail_mime, thumbnail_size)) = uploaded else {
        return Err(err("file is required"));
    };
    let video = sqlx::query("INSERT INTO videos (title, description, source_type, status, approved, thumbnail_key, file_size_bytes, created_by, metadata) VALUES ($1,$2,'upload','ready',false,$3,$4,$5,$6) RETURNING *")
        .bind(title.trim())
        .bind(description)
        .bind(&thumbnail_key)
        .bind(mp4_size)
        .bind(user.id)
        .bind(json!({"storage_policy": "optimized_only"}))
        .fetch_one(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    let video_id: Uuid = video.get("id");
    sqlx::query("INSERT INTO video_assets (video_id, kind, storage_key, mime_type, file_size_bytes, quality) VALUES ($1,'mp4',$2,'video/mp4',$3,$4)")
        .bind(video_id)
        .bind(mp4_key)
        .bind(mp4_size)
        .bind(optimized_video_quality())
        .execute(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    sqlx::query("INSERT INTO video_assets (video_id, kind, storage_key, mime_type, file_size_bytes, quality) VALUES ($1,'thumbnail',$2,$3,$4,'poster')")
        .bind(video_id)
        .bind(thumbnail_key)
        .bind(thumbnail_mime)
        .bind(thumbnail_size)
        .execute(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    audit(
        &state.db,
        Some(user.id),
        "upload",
        "video",
        Some(video_id),
        json!({"storage_policy": "optimized_only"}),
    )
    .await;
    Ok(Json(row_to_json(&video)))
}

fn optimized_video_max_height() -> i32 {
    env::var("OPTIMIZED_VIDEO_MAX_HEIGHT")
        .ok()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(720)
}

fn optimized_video_crf() -> i32 {
    env::var("OPTIMIZED_VIDEO_CRF")
        .ok()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(26)
}

fn optimized_audio_bitrate() -> String {
    env::var("OPTIMIZED_AUDIO_BITRATE").unwrap_or_else(|_| "96k".to_string())
}

fn optimized_video_preset() -> String {
    env::var("OPTIMIZED_VIDEO_PRESET").unwrap_or_else(|_| "medium".to_string())
}

fn optimized_video_quality() -> String {
    format!(
        "ipad-{}p-crf{}-{}",
        optimized_video_max_height(),
        optimized_video_crf(),
        optimized_video_preset()
    )
}

async fn run_ffmpeg(args: &[String]) -> ApiResult<()> {
    let output = tokio::time::timeout(
        Duration::from_secs(30 * 60),
        Command::new("ffmpeg").args(args).output(),
    )
    .await
    .map_err(|_| err("video optimization timed out"))?
    .map_err(|e| err(format!("failed to run ffmpeg: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("ffmpeg failed");
        return Err(err(format!("video optimization failed: {detail}")));
    }
    Ok(())
}

async fn optimize_uploaded_video(
    state: &AppState,
    bytes: Vec<u8>,
    filename: &str,
) -> ApiResult<(String, String, i64, String, i64)> {
    let upload_id = Uuid::new_v4();
    let work_dir = env::temp_dir().join(format!("happie-upload-{upload_id}"));
    fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| err(e.to_string()))?;
    let result = optimize_uploaded_video_inner(state, bytes, filename, upload_id, &work_dir).await;
    let _ = fs::remove_dir_all(&work_dir).await;
    result
}

async fn optimize_uploaded_video_inner(
    state: &AppState,
    bytes: Vec<u8>,
    filename: &str,
    upload_id: Uuid,
    work_dir: &PathBuf,
) -> ApiResult<(String, String, i64, String, i64)> {
    let source_path = work_dir.join(sanitize_filename(filename));
    let mp4_path = work_dir.join("ipad.mp4");
    let thumb_path = work_dir.join("thumbnail.jpg");
    fs::write(&source_path, bytes)
        .await
        .map_err(|_| err("failed to stage upload"))?;

    let max_height = optimized_video_max_height();
    let crf = optimized_video_crf();
    let audio_bitrate = optimized_audio_bitrate();
    let preset = optimized_video_preset();
    let scale_filter = format!(
        "scale=if(gt(ih\\,{max_height})\\,-2\\,iw):if(gt(ih\\,{max_height})\\,{max_height}\\,ih)"
    );
    run_ffmpeg(&[
        "-y".into(),
        "-i".into(),
        source_path.to_string_lossy().to_string(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-vf".into(),
        scale_filter,
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        preset,
        "-crf".into(),
        crf.to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        audio_bitrate,
        "-movflags".into(),
        "+faststart".into(),
        mp4_path.to_string_lossy().to_string(),
    ])
    .await?;
    run_ffmpeg(&[
        "-y".into(),
        "-ss".into(),
        "00:00:00.5".into(),
        "-i".into(),
        source_path.to_string_lossy().to_string(),
        "-frames:v".into(),
        "1".into(),
        thumb_path.to_string_lossy().to_string(),
    ])
    .await?;

    let mp4_bytes = fs::read(&mp4_path)
        .await
        .map_err(|_| err("failed to read optimized video"))?;
    let thumb_bytes = fs::read(&thumb_path)
        .await
        .map_err(|_| err("failed to read thumbnail"))?;
    let prefix = format!("uploads/optimized/{upload_id}");
    let mp4_key = format!("{prefix}/ipad.mp4");
    let thumbnail_key = format!("{prefix}/thumbnail.jpg");
    state
        .s3
        .client
        .put_object()
        .bucket(&state.s3.bucket)
        .key(&mp4_key)
        .content_type("video/mp4")
        .body(ByteStream::from(mp4_bytes.clone()))
        .send()
        .await
        .map_err(|_| err("failed to store optimized video"))?;
    state
        .s3
        .client
        .put_object()
        .bucket(&state.s3.bucket)
        .key(&thumbnail_key)
        .content_type("image/jpeg")
        .body(ByteStream::from(thumb_bytes.clone()))
        .send()
        .await
        .map_err(|_| err("failed to store thumbnail"))?;
    Ok((
        mp4_key,
        thumbnail_key,
        mp4_bytes.len() as i64,
        "image/jpeg".to_string(),
        thumb_bytes.len() as i64,
    ))
}

#[utoipa::path(get, path = "/storage/summary")]
async fn storage_summary(
    State(state): State<AppState>,
    _user: AuthedUser,
) -> ApiResult<Json<Value>> {
    let totals = sqlx::query("SELECT COALESCE(SUM(file_size_bytes), 0)::bigint AS total_bytes, COALESCE(SUM(CASE WHEN kind IN ('original','mp4','hls') THEN file_size_bytes ELSE 0 END), 0)::bigint AS video_bytes, COALESCE(SUM(CASE WHEN kind='thumbnail' THEN file_size_bytes ELSE 0 END), 0)::bigint AS thumbnail_bytes, COUNT(*)::bigint AS asset_count, COUNT(DISTINCT video_id)::bigint AS video_count FROM video_assets")
        .fetch_one(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    let by_kind = sqlx::query("SELECT kind, COUNT(*)::bigint AS asset_count, COALESCE(SUM(file_size_bytes), 0)::bigint AS total_bytes FROM video_assets GROUP BY kind ORDER BY total_bytes DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    let by_source = sqlx::query("SELECT v.source_type, COUNT(DISTINCT v.id)::bigint AS video_count, COALESCE(SUM(a.file_size_bytes), 0)::bigint AS total_bytes FROM videos v LEFT JOIN video_assets a ON a.video_id=v.id GROUP BY v.source_type ORDER BY total_bytes DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    let videos = sqlx::query("SELECT v.id, v.title, v.source_type, v.status, COALESCE(SUM(a.file_size_bytes), 0)::bigint AS total_bytes, COALESCE(SUM(CASE WHEN a.kind IN ('original','mp4','hls') THEN a.file_size_bytes ELSE 0 END), 0)::bigint AS video_bytes, COALESCE(SUM(CASE WHEN a.kind='thumbnail' THEN a.file_size_bytes ELSE 0 END), 0)::bigint AS thumbnail_bytes FROM videos v LEFT JOIN video_assets a ON a.video_id=v.id GROUP BY v.id ORDER BY total_bytes DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| err(e.to_string()))?;
    Ok(Json(json!({
        "total_bytes": totals.get::<i64, _>("total_bytes"),
        "video_bytes": totals.get::<i64, _>("video_bytes"),
        "thumbnail_bytes": totals.get::<i64, _>("thumbnail_bytes"),
        "asset_count": totals.get::<i64, _>("asset_count"),
        "video_count": totals.get::<i64, _>("video_count"),
        "by_kind": by_kind.iter().map(row_to_json).collect::<Vec<_>>(),
        "by_source": by_source.iter().map(row_to_json).collect::<Vec<_>>(),
        "videos": videos.iter().map(row_to_json).collect::<Vec<_>>()
    })))
}

fn validate_video_upload(content_type: &str, size_bytes: i64) -> ApiResult<()> {
    let max_mb = env::var("MAX_IMPORT_FILE_SIZE_MB")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(2048);
    if size_bytes > max_mb * 1024 * 1024 {
        return Err(err("file exceeds configured size limit"));
    }
    if !content_type.starts_with("video/") {
        return Err(err("only video uploads are allowed"));
    }
    Ok(())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ".-_".contains(c) {
                c
            } else {
                '-'
            }
        })
        .collect()
}

#[derive(Deserialize)]
struct YoutubeSearchInput {
    query: String,
}

#[utoipa::path(post, path = "/imports/youtube/search")]
async fn youtube_search(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<YoutubeSearchInput>,
) -> ApiResult<Json<Value>> {
    if req.query.trim().is_empty() {
        return Err(err("query is required"));
    }
    let row = sqlx::query("INSERT INTO import_jobs (provider, query, status, requested_by, metadata) VALUES ('youtube',$1,'searching',$2,$3) RETURNING *")
        .bind(req.query.trim()).bind(user.id).bind(json!({"legal_notice": "User is responsible for rights, platform terms, and copyright compliance."}))
        .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    audit(
        &state.db,
        Some(user.id),
        "import_search",
        "import_job",
        Some(row.get("id")),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

#[derive(Deserialize)]
struct YoutubeUrlInput {
    url: String,
    title: Option<String>,
    child_profile_id: Option<Uuid>,
    child_profile_ids: Option<Vec<Uuid>>,
    approve: Option<bool>,
    download_priority: Option<String>,
    import_kind: Option<String>,
}

#[utoipa::path(post, path = "/imports/youtube/url")]
async fn youtube_url(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<YoutubeUrlInput>,
) -> ApiResult<Json<Value>> {
    if !req.url.starts_with("http") {
        return Err(err("valid URL is required"));
    }
    if let Some(priority) = &req.download_priority {
        if !["required", "normal", "optional"].contains(&priority.as_str()) {
            return Err(err("invalid download priority"));
        }
    }
    let import_kind = req.import_kind.unwrap_or_else(|| "video".into());
    if !["video", "playlist"].contains(&import_kind.as_str()) {
        return Err(err("invalid import kind"));
    }
    let child_profile_ids = req.child_profile_ids.unwrap_or_default();
    let child_profile_ids = if child_profile_ids.is_empty() {
        req.child_profile_id.map(|id| vec![id]).unwrap_or_default()
    } else {
        child_profile_ids
    };
    for child_id in &child_profile_ids {
        sqlx::query("SELECT id FROM child_profiles WHERE id=$1 AND is_active=true")
            .bind(child_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| err("child lookup failed"))?
            .ok_or_else(|| err("child profile not found"))?;
    }
    let has_assignments = !child_profile_ids.is_empty();
    let row = sqlx::query("INSERT INTO import_jobs (provider, source_url, status, requested_by, metadata) VALUES ('youtube',$1,'pending',$2,$3) RETURNING *")
        .bind(req.url).bind(user.id).bind(json!({
            "title": req.title,
            "child_profile_id": child_profile_ids.first(),
            "child_profile_ids": child_profile_ids,
            "approve": req.approve.unwrap_or(has_assignments),
            "download_priority": req.download_priority.unwrap_or_else(|| "normal".into()),
            "import_kind": import_kind,
            "legal_notice": "User is responsible for rights, platform terms, and copyright compliance."
        }))
        .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    audit(
        &state.db,
        Some(user.id),
        "import_create",
        "import_job",
        Some(row.get("id")),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

async fn list_imports(State(state): State<AppState>, _user: AuthedUser) -> ApiResult<Json<Value>> {
    rows_json(
        sqlx::query("SELECT * FROM import_jobs ORDER BY created_at DESC")
            .fetch_all(&state.db)
            .await,
    )
}

#[utoipa::path(get, path = "/imports/{id}")]
async fn get_import(
    State(state): State<AppState>,
    _user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query("SELECT * FROM import_jobs WHERE id=$1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("import not found"))?;
    Ok(Json(row_to_json(&row)))
}

#[utoipa::path(post, path = "/imports/{id}/cancel")]
async fn cancel_import(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    sqlx::query("UPDATE import_jobs SET status='cancelled', updated_at=now() WHERE id=$1 AND status <> 'completed'").bind(id).execute(&state.db).await.map_err(|_| err("cancel failed"))?;
    audit(
        &state.db,
        Some(user.id),
        "cancel",
        "import_job",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

#[utoipa::path(post, path = "/imports/{id}/retry")]
async fn retry_import(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query(
        "UPDATE import_jobs
         SET status='pending',
             progress=0,
             error_message=NULL,
             result_video_id=NULL,
             metadata=metadata - 'worker',
             updated_at=now()
         WHERE id=$1
           AND status IN ('failed','cancelled')
           AND result_video_id IS NULL
         RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| err("retry failed"))?;

    let row =
        row.ok_or_else(|| err("only failed or cancelled imports without a video can be retried"))?;
    audit(
        &state.db,
        Some(user.id),
        "retry",
        "import_job",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(row_to_json(&row)))
}

async fn delete_import(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row =
        sqlx::query("DELETE FROM import_jobs WHERE id=$1 AND result_video_id IS NULL RETURNING id")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| err("delete failed"))?;
    if row.is_none() {
        return Err(err("import not found or already created a video"));
    }
    audit(
        &state.db,
        Some(user.id),
        "delete",
        "import_job",
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

fn worker_auth(headers: &HeaderMap, state: &AppState) -> ApiResult<()> {
    let ok = headers
        .get("x-worker-token")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == state.worker_token)
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(err("invalid worker token"))
    }
}

async fn worker_next_import(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    worker_auth(&headers, &state)?;
    let row = sqlx::query("UPDATE import_jobs SET status='downloading', progress=5, updated_at=now() WHERE id = (SELECT id FROM import_jobs WHERE status IN ('pending','searching') OR (status IN ('downloading','processing','uploading') AND updated_at < now() - interval '15 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")
        .fetch_optional(&state.db).await.map_err(|e| err(e.to_string()))?;
    Ok(Json(
        row.map(|r| row_to_json(&r)).unwrap_or_else(|| json!(null)),
    ))
}

#[derive(Deserialize)]
struct WorkerStatusInput {
    status: String,
    progress: Option<i32>,
    error_message: Option<String>,
    video: Option<WorkerVideoInput>,
    assets: Option<Vec<WorkerAssetInput>>,
    metadata: Option<Value>,
}

#[derive(Deserialize)]
struct WorkerVideoInput {
    title: String,
    description: Option<String>,
    duration_seconds: Option<i32>,
    thumbnail_key: Option<String>,
    file_size_bytes: Option<i64>,
}

#[derive(Deserialize)]
struct WorkerAssetInput {
    kind: String,
    storage_key: String,
    mime_type: String,
    quality: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    duration_seconds: Option<i32>,
    file_size_bytes: Option<i64>,
}

#[derive(Deserialize)]
struct PlaylistItemsInput {
    items: Vec<PlaylistItemInput>,
}

#[derive(Deserialize)]
struct PlaylistItemInput {
    url: String,
    title: Option<String>,
    external_id: Option<String>,
    index: Option<i32>,
}

async fn worker_create_playlist_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<PlaylistItemsInput>,
) -> ApiResult<Json<Value>> {
    worker_auth(&headers, &state)?;
    if req.items.is_empty() {
        return Err(err("playlist has no videos"));
    }
    let parent = sqlx::query("SELECT requested_by, metadata FROM import_jobs WHERE id=$1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err("playlist import not found"))?;
    let requested_by: Option<Uuid> = parent.get("requested_by");
    let parent_metadata: Value = parent.get("metadata");
    let mut created = Vec::new();
    for item in req.items {
        if !item.url.starts_with("http") {
            continue;
        }
        let metadata = json!({
            "title": item.title,
            "child_profile_id": parent_metadata.get("child_profile_id"),
            "child_profile_ids": parent_metadata.get("child_profile_ids").cloned().unwrap_or_else(|| json!([])),
            "approve": parent_metadata.get("approve").and_then(Value::as_bool).unwrap_or(false),
            "download_priority": parent_metadata.get("download_priority").and_then(Value::as_str).unwrap_or("normal"),
            "import_kind": "video",
            "playlist_parent_id": id,
            "playlist_external_id": item.external_id,
            "playlist_index": item.index,
            "legal_notice": "User is responsible for rights, platform terms, and copyright compliance."
        });
        let row = sqlx::query("INSERT INTO import_jobs (provider, source_url, selected_external_id, status, requested_by, metadata) VALUES ('youtube',$1,$2,'pending',$3,$4) RETURNING *")
            .bind(item.url)
            .bind(item.external_id)
            .bind(requested_by)
            .bind(metadata)
            .fetch_one(&state.db)
            .await
            .map_err(|e| err(e.to_string()))?;
        created.push(row_to_json(&row));
    }
    Ok(Json(
        json!({ "created_count": created.len(), "items": created }),
    ))
}

async fn worker_update_import(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<WorkerStatusInput>,
) -> ApiResult<Json<Value>> {
    worker_auth(&headers, &state)?;
    let mut result_video_id = None;
    if req.status == "completed" && req.video.is_some() {
        let Some(video) = req.video else {
            unreachable!()
        };
        let import_row =
            sqlx::query("SELECT source_url, requested_by, metadata FROM import_jobs WHERE id=$1")
                .bind(id)
                .fetch_one(&state.db)
                .await
                .map_err(|_| err("import not found"))?;
        let source_url: Option<String> = import_row.get("source_url");
        let requested_by: Option<Uuid> = import_row.get("requested_by");
        let import_metadata: Value = import_row.get("metadata");
        let approve = import_metadata
            .get("approve")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let merged_metadata = json!({
            "import": import_metadata,
            "worker": req.metadata.clone().unwrap_or_else(|| json!({}))
        });
        let row = sqlx::query("INSERT INTO videos (title, description, source_type, source_url, thumbnail_key, duration_seconds, status, approved, file_size_bytes, metadata, created_by) VALUES ($1,$2,'youtube',$3,$4,$5,'ready',$6,$7,$8,$9) RETURNING *")
            .bind(video.title).bind(video.description.unwrap_or_default()).bind(source_url).bind(video.thumbnail_key).bind(video.duration_seconds).bind(approve).bind(video.file_size_bytes).bind(merged_metadata).bind(requested_by)
            .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
        let video_id: Uuid = row.get("id");
        result_video_id = Some(video_id);
        for asset in req.assets.unwrap_or_default() {
            sqlx::query("INSERT INTO video_assets (video_id, kind, storage_key, mime_type, quality, width, height, duration_seconds, file_size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
                .bind(video_id).bind(asset.kind).bind(asset.storage_key).bind(asset.mime_type).bind(asset.quality).bind(asset.width).bind(asset.height).bind(asset.duration_seconds).bind(asset.file_size_bytes)
                .execute(&state.db).await.map_err(|e| err(e.to_string()))?;
        }
        let priority = import_metadata
            .get("download_priority")
            .and_then(Value::as_str)
            .unwrap_or("normal");
        let mut child_ids = import_metadata
            .get("child_profile_ids")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .filter_map(|value| Uuid::parse_str(value).ok())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if child_ids.is_empty() {
            if let Some(child_id) = import_metadata
                .get("child_profile_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            {
                child_ids.push(child_id);
            }
        }
        for child_id in child_ids {
            sqlx::query("INSERT INTO video_assignments (video_id, child_profile_id, download_priority) VALUES ($1,$2,$3) ON CONFLICT (video_id, child_profile_id) DO UPDATE SET download_priority=$3")
                .bind(video_id).bind(child_id).bind(priority)
                .execute(&state.db).await.map_err(|e| err(e.to_string()))?;
        }
    }
    let row = sqlx::query("UPDATE import_jobs SET status=$1, progress=$2, error_message=$3, result_video_id=COALESCE($4,result_video_id), metadata=COALESCE($5,metadata), updated_at=now() WHERE id=$6 RETURNING *")
        .bind(req.status).bind(req.progress.unwrap_or(0)).bind(req.error_message).bind(result_video_id).bind(req.metadata).bind(id)
        .fetch_one(&state.db).await.map_err(|e| err(e.to_string()))?;
    Ok(Json(row_to_json(&row)))
}

async fn presigned_get(storage: &Storage, key: &str) -> ApiResult<String> {
    storage
        .client
        .get_object()
        .bucket(&storage.bucket)
        .key(key)
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(900))
                .map_err(|_| err("invalid presign expiry"))?,
        )
        .await
        .map(|p| p.uri().to_string())
        .map_err(|_| err("failed to sign storage URL"))
}

async fn video_json(
    state: &AppState,
    row: &sqlx::postgres::PgRow,
    include_assignments: bool,
) -> ApiResult<Value> {
    let mut video = row_to_json(row);
    if let Value::Object(ref mut map) = video {
        if let Ok(Some(thumbnail_key)) = row.try_get::<Option<String>, _>("thumbnail_key") {
            if let Ok(url) = presigned_get(&state.s3, &thumbnail_key).await {
                map.insert("thumbnail_url".to_string(), json!(url));
            }
        }
        if include_assignments {
            let video_id: Uuid = row.get("id");
            let rows = sqlx::query("SELECT va.child_profile_id, va.download_priority, va.expires_at, cp.name AS child_name FROM video_assignments va JOIN child_profiles cp ON cp.id=va.child_profile_id WHERE va.video_id=$1 ORDER BY cp.name")
                .bind(video_id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| err(e.to_string()))?;
            map.insert(
                "assignments".to_string(),
                Value::Array(rows.iter().map(row_to_json).collect()),
            );
        }
    }
    Ok(video)
}

fn rows_json(rows: Result<Vec<sqlx::postgres::PgRow>, sqlx::Error>) -> ApiResult<Json<Value>> {
    Ok(Json(Value::Array(
        rows.map_err(|e| err(e.to_string()))?
            .iter()
            .map(row_to_json)
            .collect(),
    )))
}

fn row_to_json(row: &sqlx::postgres::PgRow) -> Value {
    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name();
        let value = if let Ok(v) = row.try_get::<Uuid, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<Uuid>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<String, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<String>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<i32, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<i32>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<i64, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<i64>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<bool, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<bool>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<DateTime<Utc>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Option<DateTime<Utc>>, _>(name) {
            json!(v)
        } else if let Ok(v) = row.try_get::<Value, _>(name) {
            v
        } else if let Ok(v) = row.try_get::<Option<Value>, _>(name) {
            json!(v)
        } else {
            Value::Null
        };
        map.insert(name.to_string(), value);
    }
    Value::Object(map)
}
