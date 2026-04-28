const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 1500);
const PUBLIC_DIR = path.resolve(__dirname, "..");
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://115.137.55.154:90/v1";
const LLM_MODEL = process.env.LLM_MODEL || "gemma4 e4b";
const LLM_API_KEY = process.env.LLM_API_KEY;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    send(response, 204, "");
    return;
  }

  if (request.method === "GET") {
    serveStatic(url.pathname, response);
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/summarize") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!LLM_API_KEY) {
    sendJson(response, 500, { error: "LLM_API_KEY is not configured" });
    return;
  }

  try {
    const { title = "", body = "" } = await readJson(request);
    const text = String(body).trim();

    if (!text) {
      sendJson(response, 400, { error: "body is required" });
      return;
    }

    const llmResponse = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "너는 한국어 회의록 정리 도우미야. 핵심 결정사항, 해야 할 일, 논의 요지를 짧고 명확하게 정리해.",
          },
          {
            role: "user",
            content: `제목: ${title || "제목 없음"}\n\n회의 내용:\n${text}\n\n간단히 요약해줘.`,
          },
        ],
        temperature: 0.2,
      }),
    });

    const data = await llmResponse.json();
    if (!llmResponse.ok) {
      sendJson(response, llmResponse.status, {
        error: data.error?.message || "LLM request failed",
      });
      return;
    }

    sendJson(response, 200, {
      summary: data.choices?.[0]?.message?.content?.trim() || "",
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Notes app listening on http://localhost:${PORT}`);
});

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(pathname, response) {
  const cleanPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${cleanPath}`);

  if (!filePath.startsWith(PUBLIC_DIR) || filePath.includes(`${path.sep}server${path.sep}`)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
  };
  return types[extension] || "application/octet-stream";
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}
