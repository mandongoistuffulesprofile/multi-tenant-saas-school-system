import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function CommsPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [optOuts, setOptOuts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/comms/templates"),
      api.get("/comms/messages"),
      api.get("/comms/broadcasts"),
      api.get("/comms/opt-outs"),
    ]).then(([tRes, mRes, bRes, oRes]) => {
      setTemplates(tRes.data || []);
      setMessages(mRes.data || []);
      setBroadcasts(bRes.data || []);
      setOptOuts(oRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Communications</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Templates</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{templates.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Messages</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{messages.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Broadcasts</h3>
                  <p className="text-3xl font-bold text-gray-900">{broadcasts.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Opt-outs</h3>
                  <p className="text-3xl font-bold text-gray-900">{optOuts.length}</p>
                </div>
              </div>
              <DataTable
                data={messages}
                emptyMessage="No messages found"
                columns={[
                  { key: "recipient_type", header: "Recipient" },
                  { key: "channel", header: "Channel" },
                  { key: "recipient_address", header: "Address" },
                  { key: "status", header: "Status" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}