"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FiberCode } from "@/db/schema";
import { offlineDb } from "@/lib/offline/db";
import { initSyncTriggers, syncQueuedJobs } from "@/lib/offline/sync";
import styles from "./new-job-form.module.css";

interface Market {
  id: string;
  name: string;
}

interface NewJobFormProps {
  markets: Market[];
  fiberCodes: readonly FiberCode[];
}

const today = () => new Date().toISOString().slice(0, 10);

// Issue #6: the form no longer calls the submitJob Server Action directly
// (that's the ticket #5 online-only path — service workers/background sync
// can't invoke Server Actions, and calling it directly here would mean a Job
// created with no connectivity is simply lost). Instead every submission is
// written to the local Dexie queue immediately — this succeeds with zero
// network — and then an immediate sync attempt is made in case we're
// online. The queue itself (src/lib/offline/sync.ts) is also synced on load,
// on reconnect, and periodically while the tab is foregrounded, so a Job
// queued while offline sends itself once connectivity returns without the
// Technician doing anything else.
export function NewJobForm({ markets, fiberCodes }: NewJobFormProps) {
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved-offline" | "synced" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastJobNumber, setLastJobNumber] = useState<string | null>(null);

  useEffect(() => {
    initSyncTriggers();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const jobNumber = String(formData.get("jobNumber") ?? "");

    try {
      const id = crypto.randomUUID();
      await offlineDb.queuedJobs.add({
        id,
        marketId: String(formData.get("marketId") ?? ""),
        jobNumber,
        date: String(formData.get("date") ?? ""),
        address: String(formData.get("address") ?? ""),
        fiberCode: String(formData.get("fiberCode") ?? "") as FiberCode,
        fiberFootage: Number(formData.get("fiberFootage") ?? 0),
        boreFootage: Number(formData.get("boreFootage") ?? 0),
        locate: formData.get("locate") === "on",
        directionalBore: formData.get("directionalBore") === "on",
        prebury: formData.get("prebury") === "on",
        techNotes: String(formData.get("techNotes") ?? ""),
        status: "queued",
        queuedAt: new Date().toISOString(),
      });

      form.reset();
      setLastJobNumber(jobNumber);

      // Attempt an immediate sync (covers the common online case); if it's
      // offline this simply fails silently inside syncQueuedJobs and the
      // Job stays queued for the trigger points in initSyncTriggers.
      await syncQueuedJobs();
      const stored = await offlineDb.queuedJobs.get(id);
      setStatus(stored?.status === "synced" ? "synced" : "saved-offline");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {status === "synced" ? (
        <p className={styles.success} role="status">
          Job {lastJobNumber} submitted.
        </p>
      ) : null}
      {status === "saved-offline" ? (
        <p className={styles.success} role="status">
          Job {lastJobNumber} saved on this device — will send automatically once connected.
        </p>
      ) : null}
      {status === "error" && errorMessage ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="marketId">Market</label>
        <select id="marketId" name="marketId" required defaultValue="">
          <option value="" disabled>
            Select a Market
          </option>
          {markets.map((market) => (
            <option key={market.id} value={market.id}>
              {market.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="jobNumber">Job Number</label>
        <input id="jobNumber" name="jobNumber" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="date">Date</label>
        <input id="date" name="date" type="date" required defaultValue={today()} />
      </div>

      <div className={styles.field}>
        <label htmlFor="address">Address</label>
        <input
          id="address"
          name="address"
          type="text"
          placeholder="123 Main St, City, ST 00000"
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="fiberCode">Fiber Code</label>
        <select id="fiberCode" name="fiberCode" required defaultValue="">
          <option value="" disabled>
            Select a Fiber Code
          </option>
          {fiberCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="fiberFootage">Fiber Footage (ft)</label>
        <input id="fiberFootage" name="fiberFootage" type="number" min={0} required />
      </div>

      <div className={styles.field}>
        <label htmlFor="boreFootage">Bore Footage (ft)</label>
        <input id="boreFootage" name="boreFootage" type="number" min={0} required />
      </div>

      <div className={styles.checkboxGroup}>
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input id="locate" name="locate" type="checkbox" />
          <label htmlFor="locate">Locate</label>
        </div>
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input id="directionalBore" name="directionalBore" type="checkbox" />
          <label htmlFor="directionalBore">Directional Bore</label>
        </div>
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input id="prebury" name="prebury" type="checkbox" />
          <label htmlFor="prebury">Prebury</label>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="techNotes">Tech Notes</label>
        <textarea id="techNotes" name="techNotes" />
      </div>

      <button className={styles.submit} type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Submit Job"}
      </button>
    </form>
  );
}
