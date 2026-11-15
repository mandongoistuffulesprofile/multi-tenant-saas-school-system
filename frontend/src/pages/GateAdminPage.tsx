import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Button from "../components/atoms/Button";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import { useToast } from "../components/toast/ToastProvider";

interface GateDevice {
  device_id: string;
  device_name: string;
  device_type: string;
  location: string | null;
  pairing_code: string | null;
  is_paired: boolean;
  last_seen_at: string | null;
  status: string;
}

interface RFIDTag {
  tag_id: string;
  tag_uid: string;
  holder_type: string;
  holder_id: string;
  holder_name?: string;
  is_active: boolean;
  issued_at: string | null;
}

interface GateEvent {
  event_id: string;
  device_id: string;
  tag_id: string | null;
  holder_type: string;
  holder_id: string;
  holder_name?: string;
  event_type: string;
  event_ts: string;
  verified: boolean;
}

interface GatePolicy {
  arrears_denial_enabled: boolean;
  require_photo_consent: boolean;
  offline_grace_minutes: number;
  notify_guardians: boolean;
}

const DEFAULT_POLICY: GatePolicy = {
  arrears_denial_enabled: false,
  require_photo_consent: false,
  offline_grace_minutes: 1440,
  notify_guardians: false,
};

const HOLDER_TYPES = ["LEARNER", "STAFF", "GUARDIAN"] as const;

// A person a tag can belong to, already labelled for the picker.
type HolderOption = {
  id: string;
  label: string;
  hint: string;
  search: string; // lower-cased label + hint + identifiers
};

const HOLDER_HELP: Record<string, string> = {
  LEARNER: "Search by name or admission number.",
  STAFF: "Search by name, email or role.",
  GUARDIAN: "Search by name, phone or email.",
};

const HOLDER_ENDPOINTS: Record<string, string> = {
  LEARNER: "/learners",
  STAFF: "/staff",
  GUARDIAN: "/guardians",
};

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || fallback;
}

/**
 * Gate administration: the hardware side of the gate terminal.
 *
 * Pairing a device, issuing a tag to a person and deciding what the gate does
 * about arrears all happen here, because they are decisions a school
 * administrator makes once, not something a terminal sitting in a corridor
 * should be able to change.
 */
export default function GateAdminPage() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [devices, setDevices] = useState<GateDevice[]>([]);
  const [tags, setTags] = useState<RFIDTag[]>([]);
  const [policy, setPolicy] = useState<GatePolicy>(DEFAULT_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [deviceForm, setDeviceForm] = useState({ device_name: "", device_type: "KIOSK", location: "" });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const [tagForm, setTagForm] = useState({ tag_uid: "", holder_type: "LEARNER", holder_id: "" });
  const [issuing, setIssuing] = useState(false);
  const [holderOptions, setHolderOptions] = useState<HolderOption[]>([]);
  const [holderState, setHolderState] = useState<"loading" | "content" | "error">("loading");
  const [holderQuery, setHolderQuery] = useState("");
  const [selectedHolder, setSelectedHolder] = useState<HolderOption | null>(null);

  const [taps, setTaps] = useState<GateEvent[]>([]);
  const [tapsState, setTapsState] = useState<"loading" | "content" | "error">("loading");

  const load = async () => {
    try {
      // The API pages these lists (50 by default, 200 max). One page of the
      // largest allowed size keeps the whole setup visible on this screen.
      const page = { params: { limit: 200 } };
      const [deviceRes, tagRes, policyRes] = await Promise.all([
        api.get<GateDevice[] | null>("/gate/devices", page),
        api.get<RFIDTag[] | null>("/gate/tags", page),
        api.get<GatePolicy>("/gate/policy"),
      ]);
      setDevices(Array.isArray(deviceRes.data) ? deviceRes.data : []);
      setTags(Array.isArray(tagRes.data) ? tagRes.data : []);
      if (policyRes.data) setPolicy({ ...DEFAULT_POLICY, ...policyRes.data });
      setState("content");
    } catch {
      setState("error");
    }
  };

  const loadTaps = async () => {
    setTapsState("loading");
    try {
      const res = await api.get<GateEvent[] | null>("/gate/events");
      setTaps(Array.isArray(res.data) ? res.data : []);
      setTapsState("content");
    } catch {
      setTapsState("error");
    }
  };

  useEffect(() => {
    load();
    loadTaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The person list behind the tag form. Re-read when the holder type changes,
  // because learners, staff and guardians come from different directories.
  useEffect(() => {
    let cancelled = false;
    setSelectedHolder(null);
    setHolderQuery("");
    setTagForm((f) => ({ ...f, holder_id: "" }));
    setHolderState("loading");

    const loadHolders = async () => {
      try {
        const res = await api.get<any[]>(HOLDER_ENDPOINTS[tagForm.holder_type], {
          params: { limit: 200 },
        });
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        const options: HolderOption[] = rows.map((row) => {
          if (tagForm.holder_type === "LEARNER") {
            const label = `${row.first_name} ${row.last_name}`;
            return {
              id: row.learner_id,
              label,
              hint: `${row.admission_number}${row.grade_label ? ` · ${row.grade_label}` : ""}`,
              search: `${label} ${row.admission_number}`.toLowerCase(),
            };
          }
          if (tagForm.holder_type === "STAFF") {
            const label = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.phone_number;
            return {
              // The tenant staff record, which is what a membership-based
              // holder_id refers to.
              id: row.membership_id,
              label,
              hint: `${row.role}${row.email ? ` · ${row.email}` : ""}`,
              search: `${label} ${row.email} ${row.role}`.toLowerCase(),
            };
          }
          return {
            id: row.guardian_id,
            label: row.full_name,
            hint: `${row.phone_number}${row.learner_count ? ` · ${row.learner_count} learners` : ""}`,
            search: `${row.full_name} ${row.phone_number} ${row.email ?? ""}`.toLowerCase(),
          };
        });
        setHolderOptions(options);
        setHolderState("content");
      } catch {
        if (cancelled) return;
        setHolderOptions([]);
        setHolderState("error");
      }
    };

    loadHolders();
    return () => { cancelled = true; };
  }, [tagForm.holder_type]);

  const holderMatches = useMemo(() => {
    const q = holderQuery.trim().toLowerCase();
    const pool = q ? holderOptions.filter((o) => o.search.includes(q)) : holderOptions;
    return pool.slice(0, 8);
  }, [holderOptions, holderQuery]);

  const pairDevice = async () => {
    if (!deviceForm.device_name.trim()) {
      toast("Give the device a name so staff can tell terminals apart.", { type: "error" });
      return;
    }
    setPairing(true);
    try {
      const res = await api.post<{ device_id: string; pairing_code: string }>("/gate/devices", {
        device_name: deviceForm.device_name.trim(),
        device_type: deviceForm.device_type,
        location: deviceForm.location.trim() || undefined,
      });
      setPairingCode(res.data?.pairing_code ?? null);
      setDeviceForm({ device_name: "", device_type: "KIOSK", location: "" });
      toast("Device paired. Enter the code on the terminal to link it.", { type: "success" });
      await load();
    } catch (err) {
      toast(errorMessage(err, "Could not pair the device."), { type: "error" });
    } finally {
      setPairing(false);
    }
  };

  const issueTag = async () => {
    if (!tagForm.tag_uid.trim() || !selectedHolder) {
      toast("A tag needs its UID and the person it belongs to.", { type: "error" });
      return;
    }
    setIssuing(true);
    try {
      await api.post("/gate/tags", {
        tag_uid: tagForm.tag_uid.trim(),
        holder_type: tagForm.holder_type,
        holder_id: selectedHolder.id,
      });
      setTagForm({ tag_uid: "", holder_type: tagForm.holder_type, holder_id: "" });
      setSelectedHolder(null);
      setHolderQuery("");
      toast("Tag issued.", { type: "success" });
      await load();
    } catch (err) {
      toast(errorMessage(err, "Could not issue the tag."), { type: "error" });
    } finally {
      setIssuing(false);
    }
  };

  const deactivateTag = async (tag: RFIDTag) => {
    try {
      await api.post(`/gate/tags/${tag.tag_id}/deactivate`);
      toast(`Tag ${tag.tag_uid} deactivated.`, { type: "success" });
      await load();
    } catch (err) {
      toast(errorMessage(err, "Could not deactivate the tag."), { type: "error" });
    }
  };

  const savePolicy = async () => {
    setSavingPolicy(true);
    try {
      const res = await api.put<GatePolicy>("/gate/policy", policy);
      if (res.data) setPolicy({ ...DEFAULT_POLICY, ...res.data });
      toast("Gate policy saved.", { type: "success" });
    } catch (err) {
      toast(errorMessage(err, "Could not save the gate policy."), { type: "error" });
    } finally {
      setSavingPolicy(false);
    }
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") {
    return <ViewState state="error" message="Could not load the gate setup. Check your connection and try again." onRetry={load} />;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{t("gate_admin", { defaultValue: "Gate Administration" })}</h1>
          <p className="text-caption text-muted">
            Devices, tags and access rules for the gate terminal
          </p>
        </div>
        <Badge variant="default">{devices.length} devices · {tags.filter((tag) => tag.is_active).length} active tags</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="text-heading mb-1">Pair a device</h2>
          <p className="text-caption text-muted mb-3">
            Add a terminal, then type the pairing code on the kiosk at the gate.
          </p>
          <div className="space-y-3">
            <div>
              <label className="label block mb-1" htmlFor="device-name">Device name</label>
              <input
                id="device-name"
                className="input-field w-full"
                value={deviceForm.device_name}
                onChange={(e) => setDeviceForm((f) => ({ ...f, device_name: e.target.value }))}
                placeholder="Main gate kiosk"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label block mb-1" htmlFor="device-type">Type</label>
                <select
                  id="device-type"
                  className="input-field w-full"
                  value={deviceForm.device_type}
                  onChange={(e) => setDeviceForm((f) => ({ ...f, device_type: e.target.value }))}
                >
                  <option value="KIOSK">Kiosk</option>
                  <option value="TURNSTILE">Turnstile</option>
                  <option value="HANDHELD">Handheld</option>
                </select>
              </div>
              <div>
                <label className="label block mb-1" htmlFor="device-location">Location</label>
                <input
                  id="device-location"
                  className="input-field w-full"
                  value={deviceForm.location}
                  onChange={(e) => setDeviceForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Main gate"
                />
              </div>
            </div>
            <Button variant="primary" fullWidth onClick={pairDevice} disabled={pairing}>
              {pairing ? "Pairing…" : "Pair device"}
            </Button>
            {pairingCode && (
              <div className="rounded-lg border border-kenyan-green/40 bg-kenyan-green/10 px-3 py-2 text-sm">
                Pairing code: <strong className="font-mono tracking-widest">{pairingCode}</strong>
                <p className="text-caption text-muted mt-1">Write it down now — it is shown to link this terminal.</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-heading mb-1">Issue a tag</h2>
          <p className="text-caption text-muted mb-3">
            Tie a badge UID to one learner, staff member or guardian.
          </p>
          <div className="space-y-3">
            <div>
              <label className="label block mb-1" htmlFor="tag-uid">Tag UID</label>
              <input
                id="tag-uid"
                className="input-field w-full font-mono"
                value={tagForm.tag_uid}
                onChange={(e) => setTagForm((f) => ({ ...f, tag_uid: e.target.value }))}
                placeholder="04:A2:1B:…"
              />
            </div>
            <div>
              <label className="label block mb-1" htmlFor="tag-holder-type">Holder type</label>
              <select
                id="tag-holder-type"
                className="input-field w-full"
                value={tagForm.holder_type}
                onChange={(e) => setTagForm((f) => ({ ...f, holder_type: e.target.value }))}
              >
                {HOLDER_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block mb-1" htmlFor="tag-holder-search">Holder</label>
              {selectedHolder ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{selectedHolder.label}</span>
                    <span className="block text-xs text-gray-500 truncate">{selectedHolder.hint}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs text-gray-500 hover:text-kenyan-red shrink-0"
                    onClick={() => { setSelectedHolder(null); setTagForm((f) => ({ ...f, holder_id: "" })); }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="tag-holder-search"
                    className="input-field w-full"
                    value={holderQuery}
                    onChange={(e) => setHolderQuery(e.target.value)}
                    placeholder={holderState === "loading" ? "Loading…" : "Type a name…"}
                    disabled={holderState === "loading"}
                    autoComplete="off"
                  />
                  <p className="text-caption text-muted mt-1">{HOLDER_HELP[tagForm.holder_type]}</p>
                  {holderState === "error" && (
                    <p className="text-xs text-kenyan-red mt-1">Could not load the {tagForm.holder_type.toLowerCase()} list.</p>
                  )}
                  {holderState === "content" && holderMatches.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {holderQuery.trim() ? "No match." : "Nothing to choose from yet."}
                    </p>
                  )}
                  {holderMatches.length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                      {holderMatches.map((option) => (
                        <li key={option.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-gray-50"
                            onClick={() => {
                              setSelectedHolder(option);
                              setTagForm((f) => ({ ...f, holder_id: option.id }));
                              setHolderQuery("");
                            }}
                          >
                            <span className="block text-sm text-gray-900">{option.label}</span>
                            <span className="block text-xs text-gray-500">{option.hint}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <Button variant="primary" fullWidth onClick={issueTag} disabled={issuing || !selectedHolder}>
              {issuing ? "Issuing…" : "Issue tag"}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-heading mb-1">Recent taps</h2>
            <p className="text-caption text-muted">
              The last scans the gate reported, newest first. If children are tapping and nothing appears here, the terminal is not reaching the server.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={loadTaps} disabled={tapsState === "loading"}>
            {tapsState === "loading" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {tapsState === "error" ? (
          <p className="text-sm text-kenyan-red py-2">Could not load recent taps.</p>
        ) : tapsState === "loading" ? (
          <p className="text-sm text-gray-500 py-4 text-center">Loading recent taps…</p>
        ) : taps.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No taps recorded yet. Pair a terminal and scan a tag to see activity here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">When</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Event</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Holder</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Tag</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Terminal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {taps.slice(0, 10).map((event) => {
                  const tag = tags.find((candidate) => candidate.tag_id === event.tag_id);
                  const device = devices.find((candidate) => candidate.device_id === event.device_id);
                  return (
                    <tr key={event.event_id}>
                      <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {new Date(event.event_ts).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <Badge variant={event.verified ? "success" : "default"}>{event.event_type}</Badge>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-900">
                        {event.holder_name || event.holder_type || "—"}
                        <span className="block text-xs text-gray-400">
                          {event.holder_name
                            ? event.holder_type
                            : event.holder_id
                              ? `${event.holder_type} ${event.holder_id.slice(0, 8)}`
                              : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm font-mono text-gray-600">
                        {tag ? tag.tag_uid : event.tag_id ? "unknown" : "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600">
                        {device ? device.device_name : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-heading mb-3">Devices</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No terminals paired yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {devices.map((d) => (
                  <tr key={d.device_id}>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900">{d.device_name}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{d.device_type}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{d.location || "—"}</td>
                    <td className="px-3 py-3 text-sm">
                      <Badge variant={d.is_paired ? "success" : "default"}>{d.status || (d.is_paired ? "PAIRED" : "PENDING")}</Badge>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-heading mb-3">Tags</h2>
        {tags.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No tags issued yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Tag UID</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Holder</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Issued</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tags.map((tag) => (
                  <tr key={tag.tag_id}>
                    <td className="px-3 py-3 text-sm font-mono text-gray-900">{tag.tag_uid}</td>
                    <td className="px-3 py-3 text-sm text-gray-900">
                      {tag.holder_name || tag.holder_type}
                      <span className={tag.holder_name ? "block text-xs text-gray-400" : "block text-xs text-gray-400 font-mono"}>
                        {tag.holder_name ? tag.holder_type : tag.holder_id}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      {tag.issued_at ? new Date(tag.issued_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <Badge variant={tag.is_active ? "success" : "default"}>{tag.is_active ? "ACTIVE" : "RETIRED"}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {tag.is_active && (
                        <Button variant="ghost" size="sm" onClick={() => deactivateTag(tag)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-heading mb-1">Access policy</h2>
        <p className="text-caption text-muted mb-3">
          What the gate does when a tag is scanned.
        </p>
        <div className="space-y-3">
          {[
            {
              key: "arrears_denial_enabled" as const,
              label: "Block entry on fee arrears",
              hint: "Deny entry when the learner's balance is overdue.",
            },
            {
              key: "require_photo_consent" as const,
              label: "Require photo consent",
              hint: "Skip gate photos for learners whose guardian has not consented.",
            },
            {
              key: "notify_guardians" as const,
              label: "Notify guardians",
              hint: "Send arrival and departure messages when a child taps in or out.",
            },
          ].map((row) => (
            <label key={row.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={policy[row.key]}
                onChange={(e) => setPolicy((p) => ({ ...p, [row.key]: e.target.checked }))}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{row.label}</span>
                <span className="block text-xs text-gray-500">{row.hint}</span>
              </span>
            </label>
          ))}
          <div className="max-w-xs">
            <label className="label block mb-1" htmlFor="offline-grace">Offline grace (minutes)</label>
            <input
              id="offline-grace"
              type="number"
              min={0}
              className="input-field w-full"
              value={policy.offline_grace_minutes}
              onChange={(e) => setPolicy((p) => ({ ...p, offline_grace_minutes: Number(e.target.value) || 0 }))}
            />
            <p className="text-caption text-muted mt-1">
              How long a terminal may keep scanning without reaching the server.
            </p>
          </div>
          <Button variant="primary" onClick={savePolicy} disabled={savingPolicy}>
            {savingPolicy ? "Saving…" : "Save policy"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
