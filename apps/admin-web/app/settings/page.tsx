import { Shell } from "@/components/shell";
import { Panel } from "@/components/ui";
import { API_BASE } from "@/lib/api";

export default function SettingsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Review this HappiE installation and storage connection.</p>
      </div>

      <div className="grid gap-4">
        <Panel>
          <h2 className="mb-2 font-semibold">Local API</h2>
          <p className="text-sm text-muted">{API_BASE}</p>
          <p className="mt-2 text-sm text-muted">
            HappiE is intended for a trusted local network. The API does not require login credentials.
          </p>
          <p className="mt-2 text-sm text-muted">
            OpenAPI docs are served by the HappiE backend at /docs and /openapi.json.
          </p>
        </Panel>

        <Panel>
          <h2 className="mb-2 font-semibold">Signed storage</h2>
          <p className="text-sm text-muted">
            The admin app never connects to Postgres, R2, or MinIO directly. Uploads and playback URLs are mediated by the HappiE API.
          </p>
        </Panel>
      </div>
    </Shell>
  );
}
