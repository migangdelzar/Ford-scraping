export type PageType =
  | 'catalog'
  | 'model'
  | 'technical_sheet'
  | 'comparison'
  | 'promotion'
  | 'financing'
  | 'service'
  | 'used_vehicle'
  | 'faq'
  | 'dealer_information'
  | 'unknown';

export interface StoredPage {
  id?: number;
  url: string;
  canonicalUrl: string;
  pageType: PageType;
  title: string;
  rawHtml: string;
  extractedText: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface PageLinkCandidate {
  href: string;
  targetUrl: string;
  anchorText: string;
  rel?: string;
  internal: boolean;
  linkType: 'internal' | 'external' | 'email' | 'phone' | 'other';
}

export interface CatalogCandidate {
  modelName: string;
  modelYear: number;
  startingPrice?: number;
  currency: string;
  category?: string;
  sourceUrl: string;
}

export interface UsedVehicleCandidate {
  inventoryId: string;
  title: string;
  price?: number;
  currency: string;
  mileageKm?: number;
  transmission?: 'automatic' | 'manual' | 'other';
  imageUrls: string[];
  detailUrl?: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
}

export interface SpecificationCandidate {
  name: string;
  normalizedName: string;
  valueText: string;
  valueNumeric?: number;
  unit?: string;
  category?: string;
}

export interface ComparisonAttributeCandidate {
  category: string;
  name: string;
  normalizedName: string;
  valueText: string;
  valueNumeric?: number;
  unit?: string;
}

export interface VehicleComparisonCandidate {
  modelName: string;
  modelYear: number;
  fordTrimName: string;
  competitorMake: string;
  competitorModel: string;
  competitorYear?: number;
  competitorTrim?: string;
  fordAttributes: ComparisonAttributeCandidate[];
  competitorAttributes: ComparisonAttributeCandidate[];
  fordImageUrl?: string;
  competitorImageUrl?: string;
  sourceUrl: string;
  rawData: Record<string, unknown>;
}

export interface VehicleCandidate {
  modelName: string;
  modelYear: number;
  title: string;
  description: string;
  sections: Record<string, string>;
  specifications: SpecificationCandidate[];
  features: Array<{name: string; description?: string; category?: string}>;
  images: Array<{
    url: string;
    altText?: string;
    imageType?: string;
    width?: number;
    height?: number;
  }>;
  variants?: Array<{
    name: string;
    externalId?: string;
  }>;
  sourceUrl: string;
}

export interface DocumentCandidate {
  documentType: string;
  sectionKey?: string;
  chunkIndex?: number;
  title: string;
  content: string;
  semanticContent?: string;
  variantId?: string;
  modelName?: string;
  modelYear?: number;
  offerId?: string;
  metadata: Record<string, unknown>;
}

export type OfferType =
  | 'promotion'
  | 'discount'
  | 'financing'
  | 'months_without_interest'
  | 'cashback'
  | 'lease'
  | 'trade_in'
  | 'other';

export interface OfferCandidate {
  modelName?: string;
  modelYear?: number;
  title: string;
  description?: string;
  offerType: OfferType;
  provider?: string;
  cashPrice?: number;
  discountAmount?: number;
  discountPercent?: number;
  downPaymentAmount?: number;
  downPaymentPercent?: number;
  monthlyPayment?: number;
  termMonths?: number;
  monthsWithoutInterest?: number;
  annualInterestRate?: number;
  catPercent?: number;
  taxRatePercent?: number;
  openingCommissionRatePercent?: number;
  maximumDownPaymentPercent?: number;
  lifeInsurancePrice?: number;
  currency: string;
  validFrom?: string;
  validUntil?: string;
  requiresCreditApproval: boolean;
  conditions?: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
}

export interface OfferFilters {
  offerType?: OfferType;
  provider?: string;
  model?: string;
  modelYear?: number;
  maxCashPrice?: number;
  maxMonthlyPayment?: number;
  maxDownPayment?: number;
  termMonths?: number;
  minimumMonthsWithoutInterest?: number;
  asOf?: string;
  activeOnly?: boolean;
}

export interface OfferSearchRequest {
  query: string;
  filters?: OfferFilters;
  limit?: number;
}

export interface OfferSearchCandidate {
  offerId: string;
  modelYearId?: string;
  modelName?: string;
  modelYear?: number;
  title: string;
  offerType: OfferType;
  provider?: string;
  cashPrice?: number;
  monthlyPayment?: number;
  termMonths?: number;
  monthsWithoutInterest?: number;
  annualInterestRate?: number;
  catPercent?: number;
  taxRatePercent?: number;
  openingCommissionRatePercent?: number;
  maximumDownPaymentPercent?: number;
  lifeInsurancePrice?: number;
  validFrom?: string;
  validUntil?: string;
  validityStatus: 'active' | 'expired' | 'upcoming' | 'unknown';
  dataQualityWarnings: string[];
  sourceUrl?: string;
  modelUrl?: string;
  crawledAt?: string;
}

export interface ParseResult<T> {
  value: T;
  warnings: string[];
}

export interface SearchRequest {
  query: string;
  filters?: {
    model?: string;
    minPrice?: number;
    maxPrice?: number;
    modelYear?: number;
    category?: string;
    bodyType?: string;
    fuelType?: string;
  };
  limit?: number;
}

export interface VehicleSearchCandidate {
  modelId: string;
  modelYearId: string;
  modelName: string;
  modelYear: number;
  price?: number;
  category?: string;
  sourceUrl?: string;
  modelPageUrl?: string;
  priceSourceUrl?: string;
  crawledAt?: string;
}

export interface DocumentHit {
  documentId: string;
  modelYearId: string;
  offerId?: string;
  documentType: string;
  title: string;
  content: string;
  score: number;
  sourceUrl?: string;
  crawledAt?: string;
}

export interface RankedVehicle extends VehicleSearchCandidate {
  finalScore: number;
  keywordScore: number;
  semanticScore: number;
  matchedSections: string[];
  evidence: Array<
    Pick<DocumentHit, 'title' | 'content' | 'sourceUrl' | 'crawledAt'>
  >;
}

export interface SearchResponse {
  query: string;
  results: RankedVehicle[];
  semanticSearch: 'ready' | 'unavailable';
}

export interface RankedOffer {
  offerId: string;
  modelName?: string;
  modelYear?: number;
  title: string;
  offerType: OfferType;
  provider?: string;
  cashPrice?: number;
  monthlyPayment?: number;
  monthsWithoutInterest?: number;
  annualInterestRate?: number;
  validFrom?: string;
  validUntil?: string;
  validityStatus: 'active' | 'expired' | 'upcoming' | 'unknown';
  dataQualityWarnings: string[];
  finalScore: number;
  keywordScore: number;
  semanticScore: number;
  evidence: Array<
    Pick<DocumentHit, 'title' | 'content' | 'sourceUrl' | 'crawledAt'>
  >;
}

export interface OfferSearchResponse {
  query: string;
  results: RankedOffer[];
  semanticSearch: 'ready' | 'unavailable';
}
