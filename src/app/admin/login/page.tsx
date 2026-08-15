import { safeAdminNextPath } from '@/lib/admin/session';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeAdminNextPath(params.next);
  const showError = params.error === 'invalid';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border rounded-lg shadow-sm p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Yield AI Admin</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to access internal dashboards.</p>

        {showError && (
          <p className="text-sm text-red-600 mb-4" role="alert">
            Invalid username or password.
          </p>
        )}

        <form method="POST" action="/api/admin/login" className="space-y-4">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-black text-white text-sm font-medium py-2 hover:bg-gray-800 transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
