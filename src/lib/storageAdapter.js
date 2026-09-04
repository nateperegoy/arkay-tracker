import { supabase } from "./supabaseClient";

// This adapter exists so the main app's code — originally written against Claude's
// built-in window.storage API — doesn't need to be rewritten line by line. Every
// window.storage.get/set/delete call throughout the app keeps working exactly as
// before; this file is the only thing that actually knows it's talking to a real
// database now instead of Claude's sandbox storage.

// Tables where we store one row per record, with the full record living in a
// JSONB `data` column (plus a few plain columns just for fast filtering/sorting
// that the app doesn't directly rely on to read data back).
const RECORD_TABLES = {
  "screen-orders": { table: "orders" },
  "customer-submissions": { table: "submissions" },
  "manual-tasks": { table: "manual_tasks" },
  "work-progress": { table: "work_progress" },
};

// Tables with a genuinely simple, flat shape — one row per entry, no JSONB needed.
const FLAT_TABLES = {
  "time-logs": { table: "time_logs", keyField: "date", valueField: "hours" },
  "monthly-expenses": { table: "monthly_expenses", keyField: "month", valueField: "total" },
};

async function get(key, _shared) {
  try {
    if (key === "pricing-rates") {
      const { data, error } = await supabase.from("pricing_rates").select("data").eq("id", 1).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { key, value: JSON.stringify(data.data) };
    }

    if (key === "dashboard-trusted") {
      const { data, error } = await supabase.from("app_flags").select("value").eq("key", key).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { key, value: data.value };
    }

    if (FLAT_TABLES[key]) {
      const { table, keyField, valueField } = FLAT_TABLES[key];
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      const mapped = data.map((row) => ({ [keyField]: row[keyField], [valueField]: Number(row[valueField]) }));
      return { key, value: JSON.stringify(mapped) };
    }

    if (RECORD_TABLES[key]) {
      const { table } = RECORD_TABLES[key];
      const { data, error } = await supabase.from(table).select("data");
      if (error) throw error;
      const mapped = data.map((row) => row.data);
      return { key, value: JSON.stringify(mapped) };
    }

    throw new Error(`storageAdapter: unrecognized key "${key}"`);
  } catch (err) {
    console.error("storageAdapter.get failed for key:", key, err);
    throw err;
  }
}

async function set(key, value, _shared) {
  try {
    if (key === "pricing-rates") {
      const parsed = JSON.parse(value);
      const { error } = await supabase.from("pricing_rates").upsert({ id: 1, data: parsed });
      if (error) throw error;
      return true;
    }

    if (key === "dashboard-trusted") {
      const { error } = await supabase.from("app_flags").upsert({ key, value });
      if (error) throw error;
      return true;
    }

    if (FLAT_TABLES[key]) {
      const { table, keyField, valueField } = FLAT_TABLES[key];
      const parsed = JSON.parse(value); // full array, e.g. every time log entry
      if (parsed.length > 0) {
        const rows = parsed.map((entry) => ({ [keyField]: entry[keyField], [valueField]: entry[valueField] }));
        const { error } = await supabase.from(table).upsert(rows, { onConflict: keyField });
        if (error) throw error;
      }
      // Remove any rows no longer present in the array (handles real deletions/edits)
      const keptKeys = parsed.map((entry) => entry[keyField]);
      const { data: existing, error: fetchErr } = await supabase.from(table).select(keyField);
      if (fetchErr) throw fetchErr;
      const toDelete = existing.map((r) => r[keyField]).filter((k) => !keptKeys.includes(k));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from(table).delete().in(keyField, toDelete);
        if (delErr) throw delErr;
      }
      return true;
    }

    if (RECORD_TABLES[key]) {
      const { table } = RECORD_TABLES[key];
      const parsed = JSON.parse(value); // full array of records, e.g. every order
      if (parsed.length > 0) {
        const rows = parsed.map((record) => buildRow(key, record));
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      const keptIds = parsed.map((r) => r.id);
      const { data: existing, error: fetchErr } = await supabase.from(table).select("id");
      if (fetchErr) throw fetchErr;
      const toDelete = existing.map((r) => r.id).filter((id) => !keptIds.includes(id));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from(table).delete().in("id", toDelete);
        if (delErr) throw delErr;
      }
      return true;
    }

    throw new Error(`storageAdapter: unrecognized key "${key}"`);
  } catch (err) {
    console.error("storageAdapter.set failed for key:", key, err);
    return false;
  }
}

async function del(key, _shared) {
  try {
    if (key === "dashboard-trusted") {
      const { error } = await supabase.from("app_flags").delete().eq("key", key);
      if (error) throw error;
      return true;
    }
    // Other keys are only ever deleted as part of a full "set" (an order being removed
    // from the array, for example) — direct whole-key deletion isn't used elsewhere.
    return true;
  } catch (err) {
    console.error("storageAdapter.delete failed for key:", key, err);
    return false;
  }
}

// Builds the row to upsert for a "record" table — the full record goes into the
// JSONB `data` column, plus a handful of plain columns pulled out for fast
// filtering/sorting later if ever needed (the app itself doesn't depend on these).
function buildRow(key, record) {
  if (key === "screen-orders") {
    return {
      id: record.id,
      data: record,
      status: record.status || null,
      drop_off_date: record.dropOffDate || null,
      pickup_date: record.pickupDate || null,
      customer_name: record.customerName || null,
    };
  }
  if (key === "customer-submissions") {
    return {
      id: record.id,
      data: record,
      request_type: record.requestType || null,
      submitted_date: record.submittedDate || null,
    };
  }
  if (key === "manual-tasks") {
    return {
      id: record.id,
      data: record,
      due_date: record.dueDate || null,
    };
  }
  return { id: record.id, data: record };
}

export const storageAdapter = { get, set, delete: del };

// Scoped lookup for the customer-facing form's "welcome back" recognition — only ever
// returns a first name for an exact phone match, never full order history or pricing,
// keeping this safe to call from a public-facing form.
async function lookupCustomerByPhone(phone) {
  try {
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.length < 10) return null;
    const last10 = digits.slice(-10);

    const { data, error } = await supabase
      .from("orders")
      .select("data")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error || !data) return null;

    const match = data.find((row) => {
      const rowDigits = (row.data?.phone || "").replace(/\D/g, "");
      return rowDigits.slice(-10) === last10;
    });

    if (!match || !match.data?.customerName) return null;
    return match.data.customerName.split(" ")[0] || null;
  } catch (e) {
    return null;
  }
}

storageAdapter.lookupCustomerByPhone = lookupCustomerByPhone;
