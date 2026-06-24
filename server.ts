import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Simple file-based database path
const LEADS_FILE = path.join(process.cwd(), "leads_db.json");

interface Lead {
  id: string;
  name: string;
  phone: string;
  university: string;
  preferredStay: string;
  status: "New" | "Contacted" | "Booked" | "Cancelled";
  notes?: string;
  createdAt: string;
}

// Initialise leads database if it doesn't exist
function getLeads(): Lead[] {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      const data = fs.readFileSync(LEADS_FILE, "utf-8");
      return JSON.parse(data);
    } else {
      const initialLeads: Lead[] = [
        {
          id: "lead-1",
          name: "Rohan Sharma",
          phone: "9876543210",
          university: "Amity University Bengaluru",
          preferredStay: "Degree-Stay Plan (4 Years)",
          status: "Contacted",
          notes: "Parent inquired about vegetarian food and biometrics schedule. Looking for a premium single stay.",
          createdAt: new Date(Date.now() - 3600000 * 4).toISOString()
        },
        {
          id: "lead-2",
          name: "Ananya Rao",
          phone: "8123456789",
          university: "GITAM University",
          preferredStay: "Monthly Stay Pack",
          status: "New",
          notes: "Wants double room sharing with a quiet study partner. Relocates from Visakhapatnam.",
          createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
        }
      ];
      fs.writeFileSync(LEADS_FILE, JSON.stringify(initialLeads, null, 2));
      return initialLeads;
    }
  } catch (err) {
    console.error("Error reading leads file", err);
    return [];
  }
}

function saveLeads(leads: Lead[]) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  } catch (err) {
    console.error("Error saving leads description file", err);
  }
}

// API Routes

// Retrieve leads (for landlord/inquiry dashboard)
app.get("/api/leads", (req, res) => {
  const leads = getLeads();
  // Sort by newest first
  leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(leads);
});

// Submit a new lead
app.post("/api/leads", (req, res) => {
  const { name, phone, university, preferredStay } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: "Name and Phone number are required details." });
  }

  const leads = getLeads();
  const newLead: Lead = {
    id: `lead-${Date.now()}`,
    name,
    phone,
    university: university || "Amity University Bengaluru",
    preferredStay: preferredStay || "Degree-Stay Package",
    status: "New",
    notes: "",
    createdAt: new Date().toISOString()
  };

  leads.push(newLead);
  saveLeads(leads);

  res.status(201).json({ success: true, lead: newLead });
});

// Update a lead (status, notes)
app.put("/api/leads/:id", (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const leads = getLeads();
  const leadIndex = leads.findIndex(l => l.id === id);

  if (leadIndex === -1) {
    return res.status(404).json({ error: "Inquiry lead not found." });
  }

  if (status) leads[leadIndex].status = status;
  if (notes !== undefined) leads[leadIndex].notes = notes;

  saveLeads(leads);
  res.json({ success: true, lead: leads[leadIndex] });
});

// Delete a lead
app.delete("/api/leads/:id", (req, res) => {
  const { id } = req.params;
  const leads = getLeads();
  const filtered = leads.filter(l => l.id !== id);

  if (leads.length === filtered.length) {
    return res.status(404).json({ error: "Inquiry lead not found." });
  }

  saveLeads(filtered);
  res.json({ success: true });
});

// Gemini Q&A chat endpoint
app.post("/api/chat", async (req, res) => {
  const { message, chatHistory } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY missing");
    return res.status(500).json({
      error: "Gemini API key is missing. Please configure it in the AI Studio Settings secrets panel to chat with our AI."
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });

    const systemInstruction = `You are "WeStay AI Guru", the official ultra-premium, ultra-helpful coordinator for WeStay4U student living. WeStay4U offers exceptionally polished, student-friendly luxury accommodations with immediate shuttle access to Amity University Bengaluru (campus is ~1.2 km away, 3 minutes transit, or 10 min walk) and GITAM University (campus is ~1.5 km away, 4 mins transit, or 12 min walk).

CRITICAL CONTEXT FOR ANSWERS:
- Location Advantages: Complimentary daily pickup/drop shuttle service for students of both universities!
- Rooms & Monthly Prices:
  1. Single Luxury Room: Personal bath, private wardrobe, custom desk. Starts at ₹18,000/month.
  2. Double Room Sharing: Shared with 1 neat peer, dual study set, comfy setup. Starts at ₹12,000/month.
  3. Triple Room sharing: Modern high-value layout, individual lockers. Starts at ₹9,000/month.
- Key Premium Amenities (All-Inclusive):
  - 4 Hygienic Multi-cuisine Meals daily (North & South Indian menu curated by professional chefs, strict quality control).
  - High-Speed Wi-Fi (Up to 200 Mbps to support coding, classes & gaming).
  - Heavy Duty Security: Biometrics, 24/7 CCTV, female & male Wardens physically present, emergency medical tie-up.
  - Power & Water backup: 100% stable setup.
  - Laundry & Ironing twice a week.
  - Common Recreation zone: Game console (PS5), foosball, table tennis, noise-isolation Study Room, rooftop chill space.
- "4 Years, Zero Worries" Package: Lock-in prices for the entire degree! Shield parents against rental inflation, get immediate room priority and peer network integration.

GOALS FOR ASSISTANCE:
1. Provide short, concise, scannable, engaging, and professional responses using bold markers. Avoid generic fluff.
2. If students ask how to book, guide them to use our lead capture form on the page or connect directly to booking call: +91 9121936522.
3. Address security, hygiene, and shuttle worries clearly to build swift trust for worried parents.
4. Add polite humor, and student-focused local terms. Keep your answer brief (under 120-150 words).`;

    const contents: any[] = [];
    
    // Process chat history into standard format
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach((item: any) => {
        contents.push({
          role: item.role === "user" ? "user" : "model",
          parts: [{ text: item.text }]
        });
      });
    }

    // Append current user query
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.75,
      }
    });

    const responseText = response.text || "I was unable to process your request at this moment. Let me know if I can help you with anything else!";
    res.json({ reply: responseText });

  } catch (error: any) {
    console.error("Gemini API server side error:", error);
    res.status(500).json({ error: error?.message || "Internal server error occurred while invoking Gemini." });
  }
});


// Express server hooks
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev middleware loaded successfully.");
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Static distribution folder served.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
