const fetch = require(“node-fetch”);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;

async function getQuote(symbol) {
const url = “https://query1.finance.yahoo.com/v8/finance/chart/” + symbol + “?interval=1d&range=10d”;
const res  = await fetch(url, {
headers: { “User-Agent”: “Mozilla/5.0” }
});
const data = await res.json();
const meta = data.chart.result[0].meta;
const price = meta.regularMarketPrice;
const prev  = meta.chartPreviousClose;
const change    = price - prev;
const changePct = ((change / prev) * 100).toFixed(2);
const sign      = change >= 0 ? “+” : “”;

const closes = data.chart.result[0].indicators.quote[0].close;
const recentCloses = closes
.filter(Boolean)
.slice(-5)
.map(function(c) { return c.toFixed(2); })
.join(” -> “);

const preMarket = meta.preMarketPrice
? meta.preMarketPrice.toFixed(2)
: null;

return {
symbol:       symbol,
price:        price.toFixed(2),
prev:         prev.toFixed(2),
change:       change.toFixed(2),
changePct:    changePct,
sign:         sign,
recentCloses: recentCloses,
preMarket:    preMarket,
};
}

async function getSectorData() {
const sectors = [
[“XLK”, “Tech”],
[“XLF”, “Financials”],
[“XLE”, “Energy”],
[“XLV”, “Healthcare”],
[“XLI”, “Industrials”],
[“XLY”, “Consumer Disc”],
];
const results = [];
for (const pair of sectors) {
try {
const q = await getQuote(pair[0]);
results.push(pair[1] + “: “ + q.sign + q.changePct + “%”);
} catch (e) {
results.push(pair[1] + “: N/A”);
}
}
return results.join(” | “);
}

async function getHeadlines() {
try {
const url = “https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ,SPY&region=US&lang=en-US”;
const res  = await fetch(url, {
headers: { “User-Agent”: “Mozilla/5.0” }
});
const text = await res.text();
const regex = /<title><![CDATA[(.+?)]]></title>/g;
const titles = [];
let match;
while ((match = regex.exec(text)) !== null) {
if (!match[1].includes(“Yahoo Finance”)) {
titles.push(match[1]);
}
}
return titles.slice(0, 5).length ? titles.slice(0, 5).join(”\n- “) : “No headlines available”;
} catch (e) {
return “Headlines unavailable”;
}
}

async function run() {
console.log(“Fetching market data…”);

const qqq      = await getQuote(“QQQ”);
const spy      = await getQuote(“SPY”);
const vix      = await getQuote(“VIX”);
const sectors  = await getSectorData();
const headlines = await getHeadlines();

const now     = new Date();
const dateStr = now.toLocaleDateString(“en-US”, {
weekday: “long”,
year:    “numeric”,
month:   “long”,
day:     “numeric”,
});

const qqqPrice = qqq.preMarket || qqq.price;
const spyPrice = spy.preMarket || spy.price;

const marketContext = [
“Today: “ + dateStr,
“”,
“PRE-MARKET PRICES:”,
“- QQQ: $” + qqqPrice + “ (” + qqq.sign + qqq.changePct + “% vs yesterday close of $” + qqq.prev + “)”,
“- SPY: $” + spyPrice + “ (” + spy.sign + spy.changePct + “% vs yesterday close of $” + spy.prev + “)”,
“- VIX: “ + vix.price + “ (” + vix.sign + vix.changePct + “% vs yesterday)”,
“”,
“QQQ 5-DAY CLOSE TREND: “ + qqq.recentCloses,
“SPY 5-DAY CLOSE TREND: “ + spy.recentCloses,
“”,
“SECTORS (vs yesterday close): “ + sectors,
“”,
“TOP HEADLINES:”,
“- “ + headlines,
].join(”\n”);

console.log(“Asking Claude for analysis…”);

const claudeRes = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”:      “application/json”,
“x-api-key”:         ANTHROPIC_API_KEY,
“anthropic-version”: “2023-06-01”,
},
body: JSON.stringify({
model:      “claude-opus-4-5”,
max_tokens: 600,
messages: [
{
role: “user”,
content: [
“You are a concise pre-market analyst. Given the data below, provide:”,
“1. A sentiment score from 1-10 (1=extreme fear, 10=extreme greed)”,
“2. Directional bias: Bullish / Bearish / Neutral”,
“3. 3-4 bullet points of key observations”,
“4. One short trade idea or watch level for QQQ”,
“”,
“Keep the total response under 250 words. Use plain text, no markdown.”,
“”,
marketContext,
].join(”\n”),
},
],
}),
});

const claudeData = await claudeRes.json();
const analysis   = claudeData.content[0].text;

const message = [
“📊 PRE-MARKET BRIEFING — “ + dateStr,
“”,
“💰 PRICES”,
“• QQQ: $” + qqqPrice + “ (” + qqq.sign + qqq.changePct + “%)”,
“• SPY: $” + spyPrice + “ (” + spy.sign + spy.changePct + “%)”,
“• VIX: “ + vix.price + “ (” + vix.sign + vix.changePct + “%)”,
“”,
“📰 HEADLINES”,
“• “ + headlines.replace(/\n- /g, “\n• “),
“”,
“🤖 CLAUDE ANALYSIS”,
analysis,
].join(”\n”);

console.log(“Sending to Telegram…”);

const telegramRes = await fetch(
“https://api.telegram.org/bot” + TELEGRAM_BOT_TOKEN + “/sendMessage”,
{
method:  “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
text:    message,
}),
}
);

const telegramData = await telegramRes.json();

if (!telegramData.ok) {
throw new Error(“Telegram error: “ + telegramData.description);
}

console.log(“Briefing sent successfully!”);
}

run().catch(function(err) {
console.error(“Error:”, err);
process.exit(1);
});
