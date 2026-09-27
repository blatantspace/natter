import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib";

type NameCheckResult = {
  exists: boolean;
  hasPin: boolean;
  displayName?: string;
  color?: string;
};

export function Welcome({
  workspaceName,
  onLogin,
  error: parentError,
}: {
  workspaceName: string;
  onLogin: (displayName: string, pin?: string) => Promise<void> | void;
  error: string | null;
}) {
  const [step, setStep] = useState<"name" | "pin">("name");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [nameStatus, setNameStatus] = useState<NameCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const pinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === "pin" && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [step]);

  async function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || busy) return;

    setBusy(true);
    setLocalError(null);

    try {
      const check = await api<NameCheckResult>("/api/auth/check", {
        method: "POST",
        body: JSON.stringify({ displayName: cleanName }),
      });

      setNameStatus(check);

      if (check.exists && check.hasPin) {
        // Name already has PIN, prompt for PIN
        setStep("pin");
      } else if (check.exists && !check.hasPin) {
        // Existing user without PIN -> login directly
        await onLogin(cleanName);
      } else {
        // Brand new user -> give option to set PIN or enter immediately
        setStep("pin");
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePinSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || busy) return;

    setBusy(true);
    setLocalError(null);

    try {
      await onLogin(cleanName, pin.trim() || undefined);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const activeError = localError || parentError;

  return (
    <div className="welcome">
      {step === "name" ? (
        <form className="welcome-card" onSubmit={handleNameSubmit}>
          <div className="status-pill" style={{ marginBottom: 14 }}>
            {workspaceName}
          </div>
          <h1>Natter</h1>
          <p>
            A private room for you and your friends. Pick a name and walk in.
            This device remembers you.
          </p>

          {activeError && <div className="error-banner">{activeError}</div>}

          <div className="field">
            <label htmlFor="displayName">Your Name or Handle</label>
            <input
              id="displayName"
              autoFocus
              autoComplete="nickname"
              placeholder="e.g. Sam, Alex, Jo"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setLocalError(null);
              }}
              maxLength={32}
            />
          </div>

          <button
            className="primary-btn"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      ) : (
        <form className="welcome-card" onSubmit={handlePinSubmit}>
          <div className="status-pill" style={{ marginBottom: 14 }}>
            {workspaceName}
          </div>

          {nameStatus?.exists ? (
            <>
              <h1>Welcome back, {nameStatus.displayName || name}!</h1>
              <p>
                Enter your 4-digit PIN to unlock your account on this device.
              </p>
            </>
          ) : (
            <>
              <h1>Lock in your handle, {name}!</h1>
              <p>
                Pick an optional 4-digit PIN to protect your name across other
                devices (or leave blank to skip).
              </p>
            </>
          )}

          {activeError && <div className="error-banner">{activeError}</div>}

          <div className="field">
            <label htmlFor="pinInput">
              {nameStatus?.exists ? "4-Digit PIN" : "4-Digit PIN (Optional)"}
            </label>
            <input
              ref={pinInputRef}
              id="pinInput"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                setLocalError(null);
              }}
              maxLength={4}
              style={{
                letterSpacing: "0.4em",
                fontSize: "20px",
                textAlign: "center",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => {
                setStep("name");
                setPin("");
                setLocalError(null);
              }}
              style={{
                flex: 1,
                padding: "10px 16px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Back
            </button>
            <button
              className="primary-btn"
              type="submit"
              disabled={busy || (nameStatus?.exists && pin.length < 4)}
              style={{ flex: 2 }}
            >
              {busy
                ? "Entering…"
                : nameStatus?.exists
                ? "Unlock & Enter"
                : pin
                ? "Save PIN & Enter"
                : "Enter Lounge"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
