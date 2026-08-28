"use client";

import { useState, type FormEvent } from "react";
import type { FiberCode } from "@/db/schema";
import { submitJob } from "../actions";
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

export function NewJobForm({ markets, fiberCodes }: NewJobFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastJobNumber, setLastJobNumber] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const result = await submitJob({
        // Client-generated Job id (ADR 0001's identity model) — see
        // src/app/(intake)/jobs/actions.ts for why this is generated here
        // rather than by the server.
        id: crypto.randomUUID(),
        marketId: String(formData.get("marketId") ?? ""),
        jobNumber: String(formData.get("jobNumber") ?? ""),
        date: String(formData.get("date") ?? ""),
        address: String(formData.get("address") ?? ""),
        fiberCode: String(formData.get("fiberCode") ?? "") as FiberCode,
        fiberFootage: String(formData.get("fiberFootage") ?? ""),
        boreFootage: String(formData.get("boreFootage") ?? ""),
        locate: formData.get("locate") === "on",
        directionalBore: formData.get("directionalBore") === "on",
        prebury: formData.get("prebury") === "on",
        techNotes: String(formData.get("techNotes") ?? ""),
      });

      if (result.ok) {
        setStatus("success");
        setLastJobNumber(result.job.jobNumber);
        form.reset();
      } else {
        setStatus("error");
        setErrorMessage(result.message);
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {status === "success" ? (
        <p className={styles.success} role="status">
          Job {lastJobNumber} submitted.
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

      <button className={styles.submit} type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Submitting…" : "Submit Job"}
      </button>
    </form>
  );
}
