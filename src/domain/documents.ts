import {createHash} from 'node:crypto';
import type {DocumentCandidate} from './contracts.js';

export interface VehicleAggregate {
  modelId: string;
  modelYearId: string;
  modelName: string;
  modelYear: number;
  startingPrice?: number;
  currency: string;
  category?: string;
  description?: string;
  sections: Record<string, string>;
  specifications: Array<{name: string; valueText: string}>;
}

function context(vehicle: VehicleAggregate): string {
  return [
    `Ford ${vehicle.modelName} ${vehicle.modelYear}`,
    vehicle.category ? `Categoría: ${vehicle.category}` : '',
    vehicle.startingPrice === undefined
      ? ''
      : `Precio desde: $${vehicle.startingPrice.toLocaleString('en-US')} ${vehicle.currency}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDocuments(vehicle: VehicleAggregate): DocumentCandidate[] {
  const prefix = context(vehicle);
  const documents: DocumentCandidate[] = [
    {
      documentType: 'overview',
      sectionKey: 'overview',
      chunkIndex: 0,
      title: `Ford ${vehicle.modelName} ${vehicle.modelYear}`,
      content: `${prefix}\n\n${vehicle.description ?? ''}`.trim(),
      modelName: vehicle.modelName,
      modelYear: vehicle.modelYear,
      metadata: {modelId: vehicle.modelId, modelYearId: vehicle.modelYearId},
    },
  ];

  for (const [section, text] of Object.entries(vehicle.sections)) {
    if (!text.trim()) continue;
    documents.push({
      documentType: section,
      sectionKey: section,
      chunkIndex: 0,
      title: `Ford ${vehicle.modelName} ${vehicle.modelYear} — ${section}`,
      content: `${prefix}\n\n${text.trim()}`,
      modelName: vehicle.modelName,
      modelYear: vehicle.modelYear,
      metadata: {
        modelId: vehicle.modelId,
        modelYearId: vehicle.modelYearId,
        section,
      },
    });
  }

  if (vehicle.specifications.length) {
    documents.push({
      documentType: 'specifications',
      sectionKey: 'specifications',
      chunkIndex: 0,
      title: `Ford ${vehicle.modelName} ${vehicle.modelYear} — especificaciones`,
      content: `${prefix}\n\n${vehicle.specifications.map(spec => `${spec.name}: ${spec.valueText}`).join('\n')}`,
      modelName: vehicle.modelName,
      modelYear: vehicle.modelYear,
      metadata: {modelId: vehicle.modelId, modelYearId: vehicle.modelYearId},
    });
  }

  if (vehicle.startingPrice !== undefined) {
    documents.push({
      documentType: 'pricing',
      sectionKey: 'pricing',
      chunkIndex: 0,
      title: `Ford ${vehicle.modelName} ${vehicle.modelYear} — precio`,
      content: `${prefix}\n\nPrecio de lista inicial: $${vehicle.startingPrice.toLocaleString('en-US')} ${vehicle.currency}`,
      modelName: vehicle.modelName,
      modelYear: vehicle.modelYear,
      metadata: {
        modelId: vehicle.modelId,
        modelYearId: vehicle.modelYearId,
        currency: vehicle.currency,
      },
    });
  }
  return documents;
}

export function hashDocument(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
