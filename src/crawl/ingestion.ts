import type {
  DocumentCandidate,
  StoredPage,
  VehicleCandidate,
} from '../domain/contracts.js';
import {buildDocuments} from '../domain/documents.js';
import {buildOfferDocument} from '../domain/offers.js';
import {createParserRegistry} from '../parsers/registry.js';
import {parseCatalogPage} from '../parsers/catalog-parser.js';
import {parseModelPage} from '../parsers/model-parser.js';
import {parsePublicInformationPage} from '../parsers/public-page-parser.js';
import {parseTechnicalSheet} from '../parsers/technical-sheet-parser.js';
import type {CatalogRepository} from '../storage/catalog-repository.js';
import type {DocumentRepository} from '../storage/document-repository.js';
import type {PageRepository} from '../storage/page-repository.js';
import type {OfferRepository} from '../storage/offer-repository.js';

export interface IngestionSummary {
  processed: number;
  documents: number;
  warnings: number;
  failed: number;
}

export interface PageIngestionSummary {
  processed: boolean;
  documents: number;
  warnings: number;
}

function vehicleFromTechnicalUrl(page: StoredPage): VehicleCandidate | null {
  const match = page.url.match(/\/([^/]+)\/(20\d{2}|\d{2})\/Ficha-Tecnica/i);
  if (!match) return null;
  const year =
    match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]);
  return {
    modelName: match[1].replaceAll('-', ' '),
    modelYear: year,
    title: page.title,
    description: '',
    sections: {},
    specifications: [],
    features: [],
    images: [],
    sourceUrl: page.url,
  };
}

export async function ingestPages(
  pages: PageRepository,
  catalog: CatalogRepository,
  documents: DocumentRepository,
  limit = 100,
  offers?: OfferRepository,
): Promise<IngestionSummary> {
  const summary: IngestionSummary = {
    processed: 0,
    documents: 0,
    warnings: 0,
    failed: 0,
  };
  for (const page of await pages.list(limit)) {
    try {
      const result = await ingestPage(page, catalog, documents, offers);
      summary.processed += 1;
      summary.documents += result.documents;
      summary.warnings += result.warnings;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export async function ingestPage(
  page: StoredPage,
  catalog: CatalogRepository,
  documents: DocumentRepository,
  offers?: OfferRepository,
): Promise<PageIngestionSummary> {
  const parser = createParserRegistry().find(candidate =>
    candidate.supports(page),
  );
  if (!parser) return {processed: false, documents: 0, warnings: 0};
  let documentCount = 0;
  let warningCount = 0;
  if (page.pageType === 'catalog') {
    const parsed = parseCatalogPage(page);
    warningCount += parsed.warnings.length;
    for (const candidate of parsed.value) {
      const ref = await catalog.upsertCatalog(candidate, page);
      const docs: DocumentCandidate[] = buildDocuments({
        modelId: ref.modelId,
        modelYearId: ref.modelYearId,
        modelName: candidate.modelName,
        modelYear: candidate.modelYear,
        startingPrice: candidate.startingPrice,
        currency: candidate.currency,
        category: candidate.category,
        description: '',
        sections: {},
        specifications: [],
      });
      await documents.upsertDocuments(ref, docs, page.id);
      documentCount += docs.length;
    }
  } else if (page.pageType === 'model') {
    const parsed = parseModelPage(page);
    warningCount += parsed.warnings.length;
    const ref = await catalog.upsertVehicle(parsed.value);
    await catalog.upsertSpecifications(ref, parsed.value.specifications, page);
    await catalog.upsertFeatures(ref, parsed.value.features, page);
    const docs = buildDocuments({
      modelId: ref.modelId,
      modelYearId: ref.modelYearId,
      modelName: parsed.value.modelName,
      modelYear: parsed.value.modelYear,
      currency: 'MXN',
      description: parsed.value.description,
      sections: parsed.value.sections,
      specifications: parsed.value.specifications.map(spec => ({
        name: spec.name,
        valueText: spec.valueText,
      })),
    });
    await documents.upsertDocuments(ref, docs, page.id);
    documentCount += docs.length;
  } else if (page.pageType === 'technical_sheet') {
    const parsed = parseTechnicalSheet(page);
    warningCount += parsed.warnings.length;
    const vehicle = vehicleFromTechnicalUrl(page);
    if (vehicle) {
      const ref = await catalog.upsertVehicle(vehicle);
      await catalog.upsertSpecifications(ref, parsed.value, page);
      await catalog.upsertFeatures(
        ref,
        parsed.value
          .filter(
            spec => spec.category === 'equipment' && spec.valueText !== '-',
          )
          .map(spec => ({
            name: spec.name,
            description: spec.valueText,
            category: spec.category,
          })),
        page,
      );
    }
  } else if (
    [
      'promotion',
      'financing',
      'service',
      'used_vehicle',
      'faq',
      'dealer_information',
    ].includes(page.pageType)
  ) {
    const parsed = parsePublicInformationPage(page);
    warningCount += parsed.warnings.length;
    if (offers && page.id) {
      for (const candidate of parsed.value.offers) {
        const ref = await offers.upsertOffer(candidate, page);
        await documents.upsertOfferDocument(
          ref,
          buildOfferDocument({id: ref.offerId, ...candidate}),
          page.id,
        );
        documentCount += 1;
      }
    }
    if (page.id) {
      await documents.upsertPageDocument(page.id, {
        documentType: parsed.value.documentType,
        title: parsed.value.title,
        content: parsed.value.content,
        metadata: {links: parsed.value.links},
      });
      documentCount += 1;
    }
  }
  return {processed: true, documents: documentCount, warnings: warningCount};
}
