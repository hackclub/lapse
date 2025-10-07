import Link from "next/link";
import { useAuth } from "../client/hooks/useAuth";

export default function Home() {
  const { currentUser, isLoading, signOut } = useAuth(false);
  const isLoggedIn = currentUser != null;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  
  // This design kinda sucks and is temporary

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Lapse</h1>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <>
                <span className="text-gray-600">
                  Welcome, {currentUser!.displayName}
                </span>
                <button
                  onClick={signOut}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded-md"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                href="/auth"
                className="px-4 py-2 text-sm bg-black text-white hover:bg-gray-900 rounded-md"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        <div className="text-center py-12">
          {isLoggedIn ? (
            <div>
              <h2 className="text-2xl font-semibold mb-4">Welcome to Lapse</h2>
              <p className="text-gray-600 mb-8">Create and share timelapses with ease.</p>
              <Link
                href="/timelapse/create"
                className="inline-block px-6 py-3 bg-black text-white hover:bg-gray-900 rounded-md"
              >
                Create Timelapse
              </Link>
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-semibold mb-4">Record and Share Timelapses</h2>
              <p className="text-gray-600 mb-8">
                Sign in to start creating timelapses and sharing them with the world.
              </p>
              <Link
                href="/auth"
                className="inline-block px-6 py-3 bg-black text-white hover:bg-gray-900 rounded-md"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
