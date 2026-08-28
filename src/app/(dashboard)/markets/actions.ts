"use server";

import { revalidatePath } from "next/cache";
import { auth } from "../../../../auth";
import {
  createMarket as createMarketQuery,
  renameMarket as renameMarketQuery,
  setMarketActive as setMarketActiveQuery,
} from "@/db/queries/markets";

// Only Office Staff may manage Markets. Real credential verification lands in
// ticket #4 — until then there's no way to obtain a real session in dev, but
// the role check below is what this ticket delivers, and it's what the
// Server Action tests exercise (mocking `auth()`'s return value).
async function requireOfficeStaff() {
  const session = await auth();
  if (session?.user?.role !== "office_staff") {
    throw new Error("Forbidden: office staff only");
  }
}

export async function createMarketAction(formData: FormData) {
  await requireOfficeStaff();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Market name is required");
  }
  const market = await createMarketQuery(name);
  revalidatePath("/markets");
  return market;
}

export async function renameMarketAction(id: string, formData: FormData) {
  await requireOfficeStaff();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Market name is required");
  }
  const market = await renameMarketQuery(id, name);
  revalidatePath("/markets");
  return market;
}

export async function setMarketActiveAction(id: string, active: boolean) {
  await requireOfficeStaff();
  const market = await setMarketActiveQuery(id, active);
  revalidatePath("/markets");
  return market;
}
