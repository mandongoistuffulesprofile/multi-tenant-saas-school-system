#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Working from: $(pwd)"

echo "📄 [1/3] Creating frontend/index.html..."

cat << 'HTML_EOF' > frontend/index.html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shule Yetu - Primary School Management System (SaaS)</title>
    <!-- Tailwind CSS CDN for instant styling without local build friction -->
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Inter', sans-serif;
      }
    </style>
  </head>
  <body class="bg-slate-50 text-slate-900 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
HTML_EOF

echo "⚛️ [2/3] Creating frontend/src/main.jsx..."

cat << 'JSX_EOF' > frontend/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
JSX_EOF

echo "🚀 [3/3] Committing and Pushing Vite entrypoints to GitHub..."
git add .
git commit -m "feat(frontend): add Vite index.html with Tailwind CDN and React DOM main.jsx mounter"
git push origin main || git push origin master

rm -f apply_vite_entrypoints.sh
echo "✅ Vite entrypoints successfully pushed to GitHub!"
