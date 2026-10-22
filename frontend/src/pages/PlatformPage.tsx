import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

export default function PlatformPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/platform/plans"),
      api.get("/platform/subscriptions"),
      api.get("/platform/usage"),
      api.get("/platform/exports"),
    ]).then(([pRes, sRes, uRes, eRes]) => {
      setPlans(pRes.data || []);
      setSubs(sRes.data || []);
      setUsage(uRes.data || []);
      setExports(eRes.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Platform</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Plans</h3>
            <p className="text-2xl font-bold text-blue-600">{plans.length}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Subscriptions</h3>
            <p className="text-2xl font-bold text-blue-600">{subs.length}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Usage Records</h3>
            <p className="text-2xl font-bold text-blue-600">{usage.length}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Exports</h3>
            <p className="text-2xl font-bold text-blue-600">{exports.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Plan Code</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Monthly</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Max Learners</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {plans.map((plan) => (
                <tr key={plan.plan_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{plan.plan_code}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{plan.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">KES {plan.price_monthly}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{plan.max_learners}</td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No plans found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
