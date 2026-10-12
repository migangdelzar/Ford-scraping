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
import {ComparisonParser} from '../parsers/comparison-parser.js';
import type {CatalogRepository} from '../storage/catalog-repository.js';
import type {DocumentRepository} from '../storage/document-repository.js';
import type {PageRepository} from '../storage/page-repository.js';
import type {OfferRepository} from '../storage/offer-repository.js';
import type {ComparisonRepository} from '../storage/comparison-repository.js';
import {normalizeModelKey} from '../domain/normalization.js';

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

export function buildVehicleProfileContent(
  modelName: string,
  modelYear: number,
  facts: Array<{name: string; valueText: string; category?: string}>,
): {content: string; semanticContent: string} {
  const byCategory = new Map<string, string[]>();
  for (const fact of facts) {
    const category = fact.category?.trim() || 'Características';
    const categoryFacts = byCategory.get(category) ?? [];
    categoryFacts.push(`${fact.name}: ${fact.valueText.trim()}`);
    byCategory.set(category, categoryFacts);
  }
  const content = [
    `Ficha técnica del Ford ${modelName} ${modelYear}.`,
    ...[...byCategory.entries()].map(([category, categoryFacts]) =>
      `${category}: ${categoryFacts.join('; ')}.`,
    ),
    'Los valores se conservan como aparecen en la ficha y no se asignan a una versión cuando la fuente los presenta agrupados.',
  ].join(' ');
  const sourceFacts = facts
    .map(fact => `${fact.name} ${fact.valueText}`)
    .join(' ');
  const searchTopics = [
    /todoterreno|off.?road|g\.o\.a\.t|4\s*x\s*4|vadeo|terreno/i.test(sourceFacts)
      ? 'Consultas relacionadas: manejo todoterreno, caminos difíciles o de terracería, conducción fuera del camino y aventura al aire libre.'
      : undefined,
    /cajuela|maletero|capacidad de carga|espacio de carga/i.test(sourceFacts)
      ? 'Consultas relacionadas: espacio para equipaje, maletas, carga y uso familiar.'
      : undefined,
    /pasajeros|asientos|tercera fila|3a fila/i.test(sourceFacts)
      ? 'Consultas relacionadas: espacio para pasajeros, viajes familiares y número de asientos.'
      : undefined,
    /rendimiento.*(?:km\/l|l\/100)|consumo.*(?:km\/l|l\/100)|h[ií]brid/i.test(
      `${modelName} ${sourceFacts}`,
    )
      ? 'Consultas relacionadas: tren motriz híbrido, consumo de combustible y eficiencia en ciudad.'
      : undefined,
  ].filter((topic): topic is string => Boolean(topic));
  return {
    content,
    semanticContent: [content, ...searchTopics].join(' '),
  };
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
  comparisons?: ComparisonRepository,
): Promise<IngestionSummary> {
  const summary: IngestionSummary = {
    processed: 0,
    documents: 0,
    warnings: 0,
    failed: 0,
  };
  for (const page of await pages.list(limit)) {
    try {
      const result = await ingestPage(page, catalog, documents, offers, comparisons);
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
  comparisons?: ComparisonRepository,
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
    const ref = await catalog.upsertVehicle(parsed.value, page);
    await catalog.upsertImages(ref, parsed.value.images, page);
    await catalog.upsertVariants(ref, parsed.value.variants ?? [], page);
    if (parsed.value.specifications.length > 0) {
      await catalog.upsertSpecifications(
        ref,
        parsed.value.specifications,
        page,
      );
    }
    if (parsed.value.features.length > 0) {
      await catalog.upsertFeatures(ref, parsed.value.features, page);
    }
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
      if (parsed.value.length > 0) {
        await catalog.upsertSpecifications(ref, parsed.value, page);
      }
      const features = parsed.value
        .filter(spec => spec.category === 'equipment' && spec.valueText !== '-')
        .map(spec => ({
          name: spec.name,
          description: spec.valueText,
          category: spec.category,
        }));
      if (features.length > 0) {
        await catalog.upsertFeatures(ref, features, page);
      }
      const profileFacts = parsed.value.filter(spec =>
        spec.valueText.trim() !== '' &&
        !/^[-—]$/.test(spec.valueText.trim()) &&
        !/precio|price|costo/i.test(spec.name),
      );
      if (profileFacts.length > 0) {
        const factGroups: typeof profileFacts[] = [];
        for (let offset = 0; offset < profileFacts.length; offset += 10) {
          factGroups.push(profileFacts.slice(offset, offset + 10));
        }
        await documents.upsertDocuments(
          ref,
          factGroups.map((facts, chunkIndex) => {
            const profile = buildVehicleProfileContent(
              vehicle.modelName,
              vehicle.modelYear,
              facts,
            );
            return {
              documentType: 'vehicle_profile',
              sectionKey: 'vehicle_profile',
              chunkIndex,
              title: `Ficha técnica Ford ${vehicle.modelName} ${vehicle.modelYear} (${chunkIndex + 1}/${factGroups.length})`,
              content: profile.content,
              semanticContent: profile.semanticContent,
              modelName: vehicle.modelName,
              modelYear: vehicle.modelYear,
              metadata: {
                sourceUrl: page.url,
                factCount: facts.length,
                profileKind: 'source_facts',
                chunkIndex,
              },
            };
          }),
          page.id,
        );
        await documents.pruneDocumentChunks(
          ref,
          'vehicle_profile',
          'vehicle_profile',
          factGroups.length,
        );
        documentCount += 1;
      }
    }
  } else if (page.pageType === 'comparison' && comparisons) {
    const parsed = new ComparisonParser().parse(page);
    warningCount += parsed.warnings.length;
    const ref = await comparisons.upsert(parsed.value, page);
    const descriptiveValues = (attributes: typeof parsed.value.fordAttributes) =>
      attributes
        .filter(attribute =>
          !/precio|price/i.test(attribute.name) &&
          /[\p{L}]/u.test(attribute.valueText) &&
          !/^(?:s[ií]|no|n\/a|[-—])$/i.test(attribute.valueText.trim()),
        )
        .map(attribute => `${attribute.name}: ${attribute.valueText}`);
    const content = [
      `Ford ${parsed.value.modelName} ${parsed.value.modelYear} ${parsed.value.fordTrimName}`,
      `Comparación publicada por Ford Uruapan frente a ${parsed.value.competitorMake} ${parsed.value.competitorModel} ${parsed.value.competitorYear ?? ''} ${parsed.value.competitorTrim ?? ''}`.trim(),
      ...parsed.value.fordAttributes.map(attribute => `${attribute.category} / ${attribute.name}: Ford ${attribute.valueText}`),
      ...parsed.value.competitorAttributes.map(attribute => `${attribute.category} / ${attribute.name}: ${parsed.value.competitorMake} ${attribute.valueText}`),
    ].join('\n');
    const fordNarrative = descriptiveValues(parsed.value.fordAttributes);
    const competitorNarrative = descriptiveValues(parsed.value.competitorAttributes);
    const semanticContent = [
      `Comparación de Ford ${parsed.value.modelName} ${parsed.value.modelYear} ${parsed.value.fordTrimName} con ${parsed.value.competitorMake} ${parsed.value.competitorModel} ${parsed.value.competitorYear ?? ''} ${parsed.value.competitorTrim ?? ''}.`.trim(),
      `La ficha Ford Uruapan compara equipamiento y características en las categorías ${[...new Set(parsed.value.fordAttributes.map(attribute => attribute.category).filter(Boolean))].join(', ')}.`,
      fordNarrative.length ? `En el lado Ford se describen ${fordNarrative.join('; ')}.` : undefined,
      competitorNarrative.length ? `En el lado ${parsed.value.competitorMake} se describen ${competitorNarrative.join('; ')}.` : undefined,
      'Útil para consultas que comparan versiones Ford con vehículos de otras marcas.',
    ].filter(Boolean).join(' ');
    await documents.upsertDocuments(ref, [{
      documentType: 'vehicle_comparison',
      sectionKey: `comparativo:${normalizeModelKey(parsed.value.fordTrimName)}:${normalizeModelKey(parsed.value.competitorMake + parsed.value.competitorModel)}`,
      title: `${parsed.value.modelName} ${parsed.value.modelYear} ${parsed.value.fordTrimName} vs ${parsed.value.competitorMake} ${parsed.value.competitorModel}`,
      content,
      semanticContent,
      variantId: ref.variantId,
      modelName: parsed.value.modelName,
      modelYear: parsed.value.modelYear,
      metadata: {
        sourceUrl: page.url,
        fordTrim: parsed.value.fordTrimName,
        competitorMake: parsed.value.competitorMake,
        competitorModel: parsed.value.competitorModel,
        fordImageUrl: parsed.value.fordImageUrl,
        competitorImageUrl: parsed.value.competitorImageUrl,
      },
    }], page.id);
    documentCount += 1;
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
        semanticContent: '',
        metadata: {links: parsed.value.links},
      });
      documentCount += 1;
    }
  }
  return {processed: true, documents: documentCount, warnings: warningCount};
}
