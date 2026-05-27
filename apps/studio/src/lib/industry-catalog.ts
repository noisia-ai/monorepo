export const INDUSTRY_CATALOG = [
  {
    industry: "Beauty & Personal Care",
    subindustries: ["Makeup", "Skincare", "Fragrance", "Haircare", "Dermocosmetica", "Beauty Retail", "Professional Beauty"]
  },
  {
    industry: "Retail",
    subindustries: ["Department Stores", "Grocery", "Convenience", "Specialty Retail", "E-commerce", "Marketplace", "Luxury Retail"]
  },
  {
    industry: "Fashion",
    subindustries: ["Apparel", "Footwear", "Accessories", "Luxury Fashion", "Fast Fashion", "Athleisure"]
  },
  {
    industry: "Food & Beverage",
    subindustries: ["QSR", "Restaurants", "Coffee", "Snacks", "Beverages", "Alcohol", "Dairy", "CPG Food"]
  },
  {
    industry: "Financial Services",
    subindustries: ["Banking", "Credit Cards", "Insurance", "Fintech", "Payments", "Wealth", "Credit", "Remittances"]
  },
  {
    industry: "Healthcare",
    subindustries: ["Pharma", "Hospitals", "Clinics", "Diagnostics", "Telehealth", "Wellness", "Medical Devices"]
  },
  {
    industry: "Technology",
    subindustries: ["Consumer Tech", "SaaS", "AI", "Cybersecurity", "Cloud", "Devices", "Gaming"]
  },
  {
    industry: "Telecom & Media",
    subindustries: ["Mobile Operators", "Streaming", "TV", "News", "Music", "Creators", "Entertainment"]
  },
  {
    industry: "Travel & Hospitality",
    subindustries: ["Airlines", "Hotels", "OTAs", "Tourism", "Restaurants", "Experience Economy"]
  },
  {
    industry: "Automotive & Mobility",
    subindustries: ["Auto OEM", "Dealers", "Aftermarket", "EV", "Mobility Apps", "Auto Insurance"]
  },
  {
    industry: "Education",
    subindustries: ["Universities", "Edtech", "Professional Training", "Language Learning", "K-12"]
  },
  {
    industry: "Real Estate",
    subindustries: ["Residential", "Commercial", "Proptech", "Mortgage", "Home Services"]
  },
  {
    industry: "Energy & Utilities",
    subindustries: ["Electricity", "Gas", "Solar", "Water", "Fuel", "Infrastructure"]
  },
  {
    industry: "Government & Public Sector",
    subindustries: ["Public Services", "Civic Programs", "Tourism Boards", "Public Health", "Mobility"]
  },
  {
    industry: "Sports & Fitness",
    subindustries: ["Gyms", "Sportswear", "Teams", "Leagues", "Supplements", "Outdoor"]
  },
  {
    industry: "Home & Lifestyle",
    subindustries: ["Furniture", "Home Improvement", "Decor", "Appliances", "Pets", "Garden"]
  }
] as const;

export const INDUSTRY_OPTIONS = INDUSTRY_CATALOG.map((item) => item.industry);
export const SUBINDUSTRY_OPTIONS = Array.from(
  new Set(INDUSTRY_CATALOG.flatMap((item) => item.subindustries))
).sort((a, b) => a.localeCompare(b));

export function subindustriesForIndustry(industry: string) {
  const normalized = industry.trim().toLowerCase();
  return INDUSTRY_CATALOG.find((item) => item.industry.toLowerCase() === normalized)?.subindustries ?? SUBINDUSTRY_OPTIONS;
}
