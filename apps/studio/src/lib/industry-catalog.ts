export const INDUSTRY_CATALOG = [
  {
    industry: "Beauty & Personal Care",
    aliases: ["belleza", "cuidado personal", "cosmetica", "cosmetics"],
    subindustries: [
      "Makeup",
      "Skincare",
      "Fragrance",
      "Haircare",
      "Dermocosmetica",
      "Beauty Retail",
      "Professional Beauty",
      "Mass Beauty",
      "Prestige Beauty",
      "Personal Care",
      "Men's Grooming",
      "Beauty Services"
    ]
  },
  {
    industry: "Retail",
    aliases: ["retail", "tiendas", "comercio"],
    subindustries: ["Department Stores", "Grocery", "Convenience", "Specialty Retail", "E-commerce", "Marketplace", "Luxury Retail", "Pharmacy Retail", "Wholesale Clubs"]
  },
  {
    industry: "Pet Care & Animal Supplies",
    aliases: ["mascotas", "pets", "petcare", "pet food", "comida de mascotas", "alimento para mascotas", "veterinaria"],
    subindustries: [
      "Pet eCommerce",
      "Pet Marketplace",
      "Pet Food / Alimento para mascotas",
      "Pet Treats / Premios para mascotas",
      "Pet Accessories / Accesorios para mascotas",
      "Pet Health & Veterinary",
      "Pet Pharmacy",
      "Pet Grooming",
      "Pet Services",
      "Pet Subscription Commerce",
      "Pet Retail",
      "Pet Supplies",
      "Dog Products",
      "Cat Products",
      "Aquarium & Fish Supplies",
      "Small Animal Supplies",
      "Pet Insurance"
    ]
  },
  {
    industry: "E-commerce & Marketplaces",
    aliases: ["ecommerce", "e-commerce", "marketplace", "marketplaces", "comercio electronico", "comercio electrónico"],
    subindustries: [
      "Vertical Marketplace",
      "Horizontal Marketplace",
      "DTC eCommerce",
      "Retail Marketplace",
      "Quick Commerce",
      "Subscription Commerce",
      "Last-mile Delivery",
      "Social Commerce",
      "B2B Marketplace",
      "Cross-border Commerce",
      "Marketplace Fulfillment",
      "Online Specialty Retail"
    ]
  },
  {
    industry: "Fashion",
    aliases: ["moda", "ropa", "calzado"],
    subindustries: ["Apparel", "Footwear", "Accessories", "Luxury Fashion", "Fast Fashion", "Athleisure"]
  },
  {
    industry: "Food & Beverage",
    aliases: ["alimentos", "bebidas", "food", "bebida"],
    subindustries: ["QSR", "Restaurants", "Coffee", "Snacks", "Beverages", "Alcohol", "Dairy", "CPG Food", "Meal Delivery", "Plant-based Food"]
  },
  {
    industry: "Financial Services",
    aliases: ["finanzas", "banca", "seguros", "fintech"],
    subindustries: ["Banking", "Credit Cards", "Insurance", "Fintech", "Payments", "Wealth", "Credit", "Remittances", "BNPL", "Digital Wallets"]
  },
  {
    industry: "Healthcare",
    aliases: ["salud", "health", "wellness"],
    subindustries: ["Pharma", "Hospitals", "Clinics", "Diagnostics", "Telehealth", "Wellness", "Medical Devices", "Health Insurance", "Mental Health"]
  },
  {
    industry: "Technology",
    aliases: ["tecnologia", "tecnología", "software"],
    subindustries: ["Consumer Tech", "SaaS", "AI", "Cybersecurity", "Cloud", "Devices", "Gaming", "Developer Tools", "Productivity Software"]
  },
  {
    industry: "Telecom & Media",
    aliases: ["telecom", "media", "medios"],
    subindustries: ["Mobile Operators", "Streaming", "TV", "News", "Music", "Creators", "Entertainment", "Broadband", "Podcasting"]
  },
  {
    industry: "Travel & Hospitality",
    aliases: ["viajes", "turismo", "hospitality"],
    subindustries: ["Airlines", "Hotels", "OTAs", "Tourism", "Restaurants", "Experience Economy", "Cruises", "Loyalty Programs"]
  },
  {
    industry: "Automotive & Mobility",
    aliases: ["autos", "automotriz", "movilidad"],
    subindustries: ["Auto OEM", "Dealers", "Aftermarket", "EV", "Mobility Apps", "Auto Insurance", "Ride Hailing", "Fleet Management"]
  },
  {
    industry: "Education",
    aliases: ["educacion", "educación"],
    subindustries: ["Universities", "Edtech", "Professional Training", "Language Learning", "K-12"]
  },
  {
    industry: "Real Estate",
    aliases: ["inmobiliario", "bienes raices", "bienes raíces"],
    subindustries: ["Residential", "Commercial", "Proptech", "Mortgage", "Home Services"]
  },
  {
    industry: "Energy & Utilities",
    aliases: ["energia", "energía", "utilities"],
    subindustries: ["Electricity", "Gas", "Solar", "Water", "Fuel", "Infrastructure"]
  },
  {
    industry: "Government & Public Sector",
    aliases: ["gobierno", "sector publico", "sector público"],
    subindustries: ["Public Services", "Civic Programs", "Tourism Boards", "Public Health", "Mobility"]
  },
  {
    industry: "Sports & Fitness",
    aliases: ["deportes", "fitness", "gimnasios"],
    subindustries: ["Gyms", "Sportswear", "Teams", "Leagues", "Supplements", "Outdoor"]
  },
  {
    industry: "Home & Lifestyle",
    aliases: ["hogar", "lifestyle", "muebles"],
    subindustries: ["Furniture", "Home Improvement", "Decor", "Appliances", "Pets", "Garden"]
  },
  {
    industry: "Consumer Packaged Goods",
    aliases: ["cpg", "consumo masivo", "fmcg"],
    subindustries: ["Household Care", "Baby Care", "Pet Care", "Cleaning", "Personal Hygiene", "Packaged Snacks", "Beverages"]
  },
  {
    industry: "Luxury",
    aliases: ["lujo", "premium"],
    subindustries: ["Luxury Retail", "Jewelry", "Watches", "Designer Fashion", "Luxury Beauty", "Luxury Hospitality"]
  },
  {
    industry: "Entertainment & Culture",
    aliases: ["entretenimiento", "cultura"],
    subindustries: ["Film", "Music", "Live Events", "Gaming", "Museums", "Cultural Institutions", "Ticketing"]
  },
  {
    industry: "B2B Services",
    aliases: ["servicios b2b", "consultoria", "consultoría"],
    subindustries: ["Consulting", "Legal Services", "Accounting", "HR Services", "B2B SaaS", "Agencies", "Research"]
  },
  {
    industry: "Industrial & Manufacturing",
    aliases: ["industrial", "manufactura"],
    subindustries: ["Manufacturing", "Logistics", "Supply Chain", "Chemicals", "Construction Materials", "Industrial Equipment"]
  },
  {
    industry: "Nonprofit & Social Impact",
    aliases: ["ong", "nonprofit", "impacto social"],
    subindustries: ["NGO", "Foundations", "Advocacy", "Education Access", "Public Health", "Sustainability"]
  }
] as const;

export const INDUSTRY_OPTIONS = INDUSTRY_CATALOG.map((item) => item.industry);
export const INDUSTRY_SEARCH_ALIASES = new Map(INDUSTRY_CATALOG.map((item) => [item.industry, item.aliases ?? []]));
export const SUBINDUSTRY_OPTIONS = Array.from(
  new Set(INDUSTRY_CATALOG.flatMap((item) => item.subindustries))
).sort((a, b) => a.localeCompare(b));

export function subindustriesForIndustry(industry: string) {
  const normalized = industry.trim().toLowerCase();
  return INDUSTRY_CATALOG.find((item) => item.industry.toLowerCase() === normalized)?.subindustries ?? SUBINDUSTRY_OPTIONS;
}
