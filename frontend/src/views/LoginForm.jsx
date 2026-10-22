import React, { useState } from 'react';

export default function LoginForm({ onLoginSuccess }) {
  const [subdomain, setSubdomain] = useState('demo');
  const [email, setEmail] = useState('admin@shuleyetu.ke');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, email, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        onLoginSuccess({
          token: data.token,
          user: data.user,
          subdomain,
        });
      } else {
        setError(data.error || 'Nenosiri au baruapepe si sahihi (Invalid credentials)');
      }
    } catch {
      setError('Kosa la mawasiliano na seva (Server connection error)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-xl border p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white font-black text-2xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-blue-200">
            K
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Shule Yetu Primary SaaS</h1>
          <p className="text-xs text-gray-400 mt-1">Mfumo wa Usimamizi wa Shule za Msingi (CBC)</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Kikoa cha Shule (School Subdomain)
            </label>
            <div className="flex rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
              <input
                required
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                className="w-full px-3 py-2 text-sm outline-none"
                placeholder="demo"
              />
              <span className="bg-gray-100 px-3 py-2 text-xs text-gray-400 font-semibold border-l">
                .schools.ke
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Baruapepe au Nambari ya Simu (Email/Phone)
            </label>
            <input
              required
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="admin@shuleyetu.ke"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Nenosiri (Password)
            </label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md shadow-blue-200 mt-2"
          >
            {loading ? 'Inaingia... / Signing in...' : 'Ingia kwenye Mfumo (Sign In)'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t text-center">
          <p className="text-xs text-gray-400">
            Akaunti ya Majaribio (Demo): <span className="font-semibold text-gray-600">admin@shuleyetu.ke</span> / <span className="font-semibold text-gray-600">Password123!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
