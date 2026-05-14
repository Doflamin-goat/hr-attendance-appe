import { useState } from "react";
import { Navigate } from "react-router";
import { LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button, Input, Select, AlertMessage } from "../components/ui";

export default function LoginPage() {
  const { signIn, user, loading, configError } = useAuth();

  const [email, setEmail] = useState("app@attendance.local");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorText("");
    setIsSubmitting(true);

    const result = await signIn(email, password);

    if (!result.success) {
      setErrorText(result.message);
    }

    setIsSubmitting(false);
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-slate-100"
      style={{
        backgroundImage: "url('/Designer.png')",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        backgroundPosition: "center right",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-slate-100/95 via-slate-100/60 to-transparent" />

      <div className="relative z-10 flex min-h-screen items-center justify-start px-6 py-10 lg:px-24">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl lg:p-10">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-700 shadow-sm">
              <img
                src="/Watts-logo.png"
                alt="Watts Logo"
                className="h-10 w-10 object-contain"
              />
            </div>

            <div>
              <h1 className="text-xl font-bold leading-tight text-slate-900">
                WATTS App TimeCore
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                HR Attendance System
              </p>
            </div>
          </div>

          {configError && (
            <div className="mb-5">
              <AlertMessage
                tone="warning"
                title="Configuration warning"
                message={configError}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Account Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            >
              <option value="app@attendance.local">APP</option>
              <option value="wais@attendance.local">WAIS</option>
            </Select>

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />

            {errorText && (
              <AlertMessage tone="error" message={errorText} />
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              disabled={isSubmitting || !!configError}
              leftIcon={<LogIn className="h-4 w-4" />}
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} App Electric Corporation
          </p>
        </div>
      </div>
    </div>
  );
}
