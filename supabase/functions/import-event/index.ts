const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseDateAndVenue(details: string) {
    const parts = details.split("·").map(part => part.trim()).filter(Boolean);
    let date = parts[0] ?? null;
    let venue = parts[1] ?? null;

    if (date) {
        const parsed = new Date(date);
        if (!Number.isNaN(parsed.getTime())) {
            date = parsed.toISOString().slice(0, 10);
        }
    }

    return { date, venue };
}

function extractEventData(html: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const title = doc.querySelector("h1")?.textContent?.trim() || null;
    let date = null;
    let venue = null;

    const heading = doc.querySelector("h1");
    if (heading?.nextElementSibling?.textContent) {
        const parsed = parseDateAndVenue(heading.nextElementSibling.textContent.trim());
        date = parsed.date;
        venue = parsed.venue;
    }

    if (!date || !venue) {
        const paragraphs = Array.from(doc.querySelectorAll("p"))
            .map(p => p.textContent?.trim() ?? "")
            .filter(Boolean);

        for (const paragraph of paragraphs) {
            if (!date || !venue) {
                const parsed = parseDateAndVenue(paragraph);
                date = date || parsed.date;
                venue = venue || parsed.venue;
            }
        }
    }

    return { name: title, date, venue };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        console.error("import-event: method not allowed", req.method);
        return new Response(JSON.stringify({ error: "Method not allowed", ok: false }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        const body = await req.json();
        const url = String(body?.url || "").trim();
        if (!url) {
            console.error("import-event: missing url");
            return new Response(JSON.stringify({ error: "URL is required", ok: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        let validatedUrl: URL;
        try {
            validatedUrl = new URL(url);
        } catch (e) {
            console.error("import-event: invalid url", e);
            return new Response(JSON.stringify({ error: "Invalid URL", ok: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const response = await fetch(validatedUrl.toString(), {
            headers: {
                "User-Agent": "Soulcomms-Importer/1.0",
                "Accept": "text/html,*/*",
            },
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            console.error(`import-event: upstream fetch failed ${response.status}`, text.slice(0, 200));
            return new Response(JSON.stringify({ error: `Failed to fetch URL (${response.status})`, details: text.slice(0, 1000), ok: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const html = await response.text();
        const eventData = extractEventData(html);

        if (!eventData.name) {
            console.error("import-event: parse failed, event name missing", { url, snippet: html.slice(0, 500) });
            return new Response(JSON.stringify({ error: "Could not detect event information from the page", ok: false, raw: html.slice(0, 2000) }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ ...eventData, ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("import-event: exception", String(error));
        return new Response(JSON.stringify({ error: String(error), ok: false }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
