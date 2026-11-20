export const config = {
  production: process.env.NODE_ENV === "production",
  url: (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, ""),
  brand: process.env.BRAND_NAME || "WABlast",
  secure: process.env.COOKIE_SECURE === "true",
  publicSignup: process.env.PUBLIC_SIGNUP === "true",
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  smtp: process.env.SMTP_URL,
  mailFrom: process.env.MAIL_FROM,
  paymentInstructions: process.env.PAYMENT_INSTRUCTIONS || "",
  supportEmail: process.env.SUPPORT_EMAIL || "",
  businessName: process.env.BUSINESS_NAME || "",
  workerMs: 5000,
};
const price = (key, fallback) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value < 1000)
    throw Error(`${key} must be an integer >= 1000`);
  return value;
};
export const plans = {
  trial: {
    name: "Trial",
    price: 0,
    days: 7,
    messages: 50,
    contacts: 100,
    seats: 1,
    batch: 50,
  },
  starter: {
    name: "Starter",
    price: price("PRICE_STARTER", 99000),
    days: 30,
    messages: 1000,
    contacts: 1000,
    seats: 1,
    batch: 100,
  },
  growth: {
    name: "Growth",
    price: price("PRICE_GROWTH", 249000),
    days: 30,
    messages: 5000,
    contacts: 5000,
    seats: 3,
    batch: 250,
  },
  business: {
    name: "Business",
    price: price("PRICE_BUSINESS", 499000),
    days: 30,
    messages: 15000,
    contacts: 15000,
    seats: 5,
    batch: 500,
  },
};
const appUrl = new URL(config.url);
if (appUrl.origin !== config.url)
  throw Error(
    "APP_URL must be an origin without a path, query, or credentials",
  );
if (
  config.production &&
  (!config.url.startsWith("https://") || !config.secure)
) {
  throw Error("Production requires HTTPS APP_URL and COOKIE_SECURE=true");
}
