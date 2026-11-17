import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "database.json");
const PORT = process.env.PORT || 3000;
const EMPTY = { students: null, attendanceRecords: null, sqlLogs: null };

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

async function initDb() {
  if (!pool) {
    console.log("Sin DATABASE_URL: usando database.json local");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Si la tabla esta vacia y existe database.json, lo importa una sola vez
  const { rowCount } = await pool.query("SELECT 1 FROM app_state WHERE id = 1");
  if (rowCount === 0 && fs.existsSync(DB_FILE)) {
    const seed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    await pool.query("INSERT INTO app_state (id, data) VALUES (1, $1)", [seed]);
    console.log("Datos importados desde database.json a Postgres");
  }
  console.log("Base de datos lista");
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/api/db", async (req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query("SELECT data FROM app_state WHERE id = 1");
      return res.json(rows[0]?.data ?? EMPTY);
    }
    if (fs.existsSync(DB_FILE)) {
      return res.json(JSON.parse(fs.readFileSync(DB_FILE, "utf-8")));
    }
    res.json(EMPTY);
  } catch (err) {
    console.error("Error al leer:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/api/db", async (req, res) => {
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
        [req.body]
      );
    } else {
      fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2), "utf-8");
    }
    res.json({ success: true, message: "Base de datos guardada" });
  } catch (err) {
    console.error("Error al guardar:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

initDb()
  .catch((err) => console.error("Error iniciando la base de datos:", err))
  .finally(() => {
    app.listen(Number(PORT), "0.0.0.0", () => console.log("Servidor en puerto", PORT));
  });