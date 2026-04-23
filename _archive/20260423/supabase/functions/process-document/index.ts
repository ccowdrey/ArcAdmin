// supabase/functions/process-document/index.ts
// Receives extracted text from Vercel, cleans PDF artifacts, chunks + embeds + stores.
//
// Accepts three mutually-exclusive scope identifiers:
//   - vehicle_id         → chunks scoped to one vehicle (legacy)
//   - build_line_id      → chunks scoped to a build line (legacy)
//   - company_manual_id  → chunks scoped to a company manual (NEW for library feature)
//
// When company_manual_id is set, status updates go to company_manuals instead of
// vehicle_documents. Exactly one scope ID must be provided.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const supabase = createClient(SUPA_URL, SUPA_SERVICE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  try {
    let body: any = {};
    try { const t = await req.text(); if (t.length > 0) body = JSON.parse(t); } catch (_) { return resp({ error: "Invalid body" }, 400); }

    const { document_id, vehicle_id, build_line_id, company_manual_id, document_type, extracted_text } = body;
    if (!document_id || !extracted_text) return resp({ error: "document_id and extracted_text required" }, 400);

    // Exactly one scope id required
    const scopes = [vehicle_id, build_line_id, company_manual_id].filter(Boolean);
    if (scopes.length !== 1) {
      return resp({ error: "exactly one of vehicle_id, build_line_id, or company_manual_id required" }, 400);
    }
    const isCompanyManual = !!company_manual_id;
    const statusTable = isCompanyManual ? "company_manuals" : "vehicle_documents";

    console.log(`📄 Embedding ${document_id} (${extracted_text.length} chars) — scope: ${isCompanyManual ? 'company_manual' : (vehicle_id ? 'vehicle' : 'build_line')}`);

    // Basic whitespace normalization
    let text = extracted_text.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();

    // PDF artifact cleaning — fix OCR issues, page numbers, ligatures, etc.
    text = cleanExtractedText(text);

    console.log(`🧹 Cleaned text: ${text.length} chars (was ${extracted_text.length})`);

    // Chunk
    const chunks = chunk(text, document_type || "manual");
    console.log(`🧩 ${chunks.length} chunks`);
    if (chunks.length === 0) { await fail(document_id, "No chunks", statusTable); return resp({ error: "No chunks" }, 422); }

    // Embed
    console.log(`🔢 Embedding...`);
    const embs = await embed(chunks.map(c => c.content));

    // Store — delete existing chunks for this document first (supports reprocessing)
    if (isCompanyManual) {
      await supabase.from("document_chunks").delete().eq("company_manual_id", company_manual_id);
    } else {
      await supabase.from("document_chunks").delete().eq("document_id", document_id);
    }

    const rows = chunks.map((c, i) => {
      const row: any = {
        chunk_index: i, content: c.content,
        metadata: { ...c.metadata, extraction_method: "claude_vercel" },
        embedding: `[${embs[i].join(",")}]`, token_count: Math.ceil(c.content.length / 4),
      };
      // document_id FK points to vehicle_documents.id — only set it for
      // vehicle_documents-scoped uploads. Company manuals live in a separate
      // table and use company_manual_id for scoping; document_id stays NULL.
      if (!isCompanyManual) row.document_id = document_id;
      // Exactly one of these three scope columns gets set (check constraint enforces this).
      if (vehicle_id) row.vehicle_id = vehicle_id;
      else if (build_line_id) row.build_line_id = build_line_id;
      else if (company_manual_id) row.company_manual_id = company_manual_id;
      return row;
    });
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from("document_chunks").insert(rows.slice(i, i + 50));
      if (error) { console.error("Insert error:", error); await fail(document_id, error.message, statusTable); return resp({ error: "Insert failed: " + error.message }, 500); }
    }

    // Update status in the appropriate table.
    // company_manuals uses processing_status values: pending | processing | completed | failed
    // vehicle_documents uses: pending | processing | ready | failed (legacy)
    if (isCompanyManual) {
      await supabase.from("company_manuals")
        .update({ processing_status: "completed", error_message: null })
        .eq("id", company_manual_id);
    } else {
      await supabase.from("vehicle_documents")
        .update({ processing_status: "ready", chunk_count: chunks.length, error_message: null })
        .eq("id", document_id);
    }

    console.log(`✅ ${chunks.length} chunks stored`);
    return resp({ success: true, chunk_count: chunks.length });
  } catch (err) { console.error("Err:", err); return resp({ error: err.message }, 500); }
});

// ════════════════════════════════════════════════
// PDF TEXT CLEANING
// Fixes extraction artifacts before chunking.
// ════════════════════════════════════════════════

function cleanExtractedText(text: string): string {
  let c = text;
  c = fixLigatures(c);
  c = fixSpacedLetters(c);
  c = fixMashedWords(c);
  c = fixRomanNumeralJunk(c);
  c = fixDotLeaders(c);
  c = fixExclamationDots(c);
  c = fixDuplicateHeaders(c);
  c = removeOrphanedPageNumbers(c);
  c = removeDuplicateHeaders(c);
  c = collapseWhitespace(c);
  return c.trim();
}

// Roman numeral artifacts from PDF page numbering (VVIVIVVV, IIIIII, VIIVI, etc.)
function fixRomanNumeralJunk(text: string): string {
  return text.replace(/\b[IVX]{3,}\b/g, '');
}

// Dot leaders from table of contents (............)
function fixDotLeaders(text: string): string {
  let c = text.replace(/(?:\. ){3,}\./g, ' ');
  c = c.replace(/\.{4,}/g, ' ');
  c = c.replace(/#\$/g, '');
  return c;
}

// !.!.!. exclamation/dot patterns and WORD!WORD patterns
function fixExclamationDots(text: string): string {
  let c = text.replace(/(!\.)+!?/g, '...');
  c = c.replace(/(\w)!(\w)/g, '$1 $2');
  return c;
}

// Duplicate content headers: "Table of ContentsTable of Contents"
function fixDuplicateHeaders(text: string): string {
  return text.replace(/(Table of Contents)\1+/gi, '$1');
}

// Fix "Yo u r M O D E m a y h a v e" → "Your MODE may have"
function fixSpacedLetters(text: string): string {
  return text.replace(
    /\b((?:[A-Za-z] ){3,}[A-Za-z])\b/g,
    (match) => {
      const collapsed = match.replace(/ /g, "");
      return collapsed.length >= 3 ? collapsed : match;
    }
  );
}

// Fix "Twistoffthestrainerbowlcounterclockwise" → "Twist off the strainer bowl counterclockwise"
function fixMashedWords(text: string): string {
  const dict = [
    "counterclockwise", "clockwise", "underneath", "replacement", "temperature",
    "maintenance", "recommended", "information", "installation", "instructions",
    "accessories", "refrigerator", "specifications", "approximately", "troubleshoot",
    "strainer", "battery", "charger", "inverter", "breaker", "circuit", "voltage",
    "pressure", "capacity", "warranty", "exterior", "interior", "plumbing",
    "antifreeze", "winterize", "sanitize", "electrical", "disconnect",
    "propane", "furnace", "vehicle", "chassis", "sprinter", "overland",
    "caution", "warning", "danger", "section", "chapter", "ensure",
    "twist", "turn", "push", "pull", "open", "close", "remove", "install",
    "check", "clean", "drain", "flush", "fill", "empty", "rinse",
    "pump", "tank", "hose", "pipe", "valve", "filter", "screen",
    "bowl", "cover", "panel", "door", "switch", "button", "lever",
    "water", "fresh", "gray", "grey", "black", "waste", "power",
    "system", "until", "while", "after", "before", "below", "above",
    "under", "over", "into", "from", "with", "your", "this", "that",
    "will", "must", "should", "could", "would", "does", "have", "been",
    "make", "sure", "only", "also", "then", "next", "each", "both",
    "the", "and", "for", "not", "are", "but", "can", "off", "all",
  ];

  return text.replace(/\b[a-zA-Z]{25,}\b/g, (longWord) => {
    if (longWord.includes("http") || longWord.includes("www")) return longWord;
    if (longWord === longWord.toUpperCase()) return longWord;
    return splitMashed(longWord.toLowerCase(), dict);
  });
}

function splitMashed(word: string, dict: string[]): string {
  if (word.length < 6) return word;
  const result: string[] = [];
  let rem = word, iter = 0;
  while (rem.length > 0 && iter < 50) {
    iter++;
    let matched = false;
    for (const d of dict) {
      if (rem.startsWith(d)) { result.push(d); rem = rem.slice(d.length); matched = true; break; }
    }
    if (!matched) {
      if (result.length > 0 && result[result.length - 1].length <= 2) result[result.length - 1] += rem[0];
      else result.push(rem[0]);
      rem = rem.slice(1);
    }
  }
  const matchedChars = result.filter(w => w.length >= 3).reduce((s, w) => s + w.length, 0);
  if (matchedChars / word.length >= 0.7) {
    const words = result.filter(w => w.length > 0);
    if (words.length > 0) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return words.join(" ");
  }
  return word;
}

// Remove standalone page numbers
function removeOrphanedPageNumbers(text: string): string {
  return text.split("\n").filter(line => {
    const t = line.trim();
    if (/^\d{1,4}$/.test(t)) return false;
    if (/^\d{4}$/.test(t)) {
      const a = parseInt(t.slice(0, 2)), b = parseInt(t.slice(2, 4));
      if (Math.abs(a - b) <= 2) return false;
    }
    return true;
  }).join("\n");
}

// "Title – Section 2 Section 2 – Title" → "Title – Section 2"
function removeDuplicateHeaders(text: string): string {
  return text.replace(
    /([A-Za-z\s/]+)\s*[–-]\s*Section\s*(\d+)\s+Section\s*\d+\s*[–-]\s*[A-Za-z\s/]+/gi,
    "$1 – Section $2"
  );
}

// Fix ligatures and smart quotes
function fixLigatures(text: string): string {
  return text
    .replace(/\uFB00/g, "ff").replace(/\uFB01/g, "fi").replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi").replace(/\uFB04/g, "ffl")
    .replace(/\u201C/g, '"').replace(/\u201D/g, '"')
    .replace(/\u2018/g, "'").replace(/\u2019/g, "'")
    .replace(/\u2013/g, "–").replace(/\u2014/g, "—")
    .replace(/\u2026/g, "...").replace(/\u00A0/g, " ");
}

function collapseWhitespace(text: string): string {
  return text.replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").split("\n").map(l => l.trimEnd()).join("\n");
}

// ════════════════════════════════════════════════
// CHUNKING
// ════════════════════════════════════════════════

interface C { content: string; metadata: { section_title?: string; document_type: string; chunk_index: number } }
function chunk(t: string, dt: string): C[] {
  const cs: C[] = [], ps = t.split(/\n{2,}/); let b = "", s = "", i = 0;
  for (const p of ps) { const v = p.trim(); if (!v) continue;
    if (/^#{1,4}\s/.test(v) || (v.length >= 3 && v.length <= 80 && v === v.toUpperCase() && /[A-Z]/.test(v)) || (v.endsWith(":") && v.length <= 60) || (/^(\d+\.?\d*\.?\s|Chapter\s+\d)/i.test(v) && v.length <= 80) || /^---\s*Page/i.test(v)) {
      s = v.replace(/^#+\s*/, "").replace(/:$/, "").trim();
      if (b.length > 720) { cs.push({ content: b.trim(), metadata: { section_title: s || undefined, document_type: dt, chunk_index: i++ } }); b = b.length > 200 ? b.slice(-200) : b; }
      b += (b ? "\n\n" : "") + v; continue;
    }
    if (b.length + v.length > 2400 && b.length > 0) { cs.push({ content: b.trim(), metadata: { section_title: s || undefined, document_type: dt, chunk_index: i++ } }); b = (b.length > 200 ? b.slice(-200) : b) + "\n\n" + v; }
    else { b += (b ? "\n\n" : "") + v; }
  }
  if (b.trim().length > 50) cs.push({ content: b.trim(), metadata: { section_title: s || undefined, document_type: dt, chunk_index: i } });
  return cs;
}

// ════════════════════════════════════════════════
// EMBEDDING
// ════════════════════════════════════════════════

async function embed(texts: string[]): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const r = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "text-embedding-3-small", input: batch, dimensions: 1536 }) });
    if (!r.ok) throw new Error(`Embed err ${r.status}`);
    (await r.json()).data.sort((a:any,b:any) => a.index-b.index).forEach((d:any) => all.push(d.embedding));
    if (i + 100 < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════

async function fail(id: string, m: string, table: string) {
  // For company_manuals, id IS the manual_id (and also the document_id from the caller's perspective).
  // For vehicle_documents, id is the vehicle_documents row id.
  await supabase.from(table).update({ processing_status: "failed", error_message: m }).eq("id", id);
}
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }; }
function resp(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", ...cors() } }); }
