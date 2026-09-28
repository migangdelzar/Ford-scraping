import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import type {StoredPage} from '../../src/domain/contracts.js';
import {ingestPage} from '../../src/crawl/ingestion.js';

describe('model page ingestion', () => {
  it('persists parsed features with their source page', async () => {
    const page: StoredPage = {
      id: 12,
      url: 'https://www.forduruapan.mx/TERRITORY/26/',
      canonicalUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
      pageType: 'model',
      title: 'Ford Territory 2026',
      rawHtml: readFileSync('fixtures/pages/model.html', 'utf8'),
      extractedText: '',
      contentHash: 'model-fixture',
      metadata: {},
    };
    const ref = {modelId: 'model-1', modelYearId: 'year-1'};
    const catalog = {
      upsertVehicle: vi.fn().mockResolvedValue(ref),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {upsertDocuments: vi.fn().mockResolvedValue(undefined)};

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertFeatures).toHaveBeenCalledWith(
      ref,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Cuenta con pantalla y conectividad.',
          category: 'tecnología',
        }),
      ]),
      page,
    );
  });

  it('persists present equipment from technical sheets as sourced features', async () => {
    const page: StoredPage = {
      id: 13,
      url: 'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
      canonicalUrl: 'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
      pageType: 'technical_sheet',
      title: 'Ficha técnica Territory 2026',
      rawHtml: `<div class="datos-ficha"><div class="seccion">
        <div class="seccion-item">Control Crucero</div>
        <div class="seccion-item">Adaptativo</div>
      </div></div>`,
      extractedText: '',
      contentHash: 'technical-fixture',
      metadata: {},
    };
    const ref = {modelId: 'model-1', modelYearId: 'year-1'};
    const catalog = {
      upsertVehicle: vi.fn().mockResolvedValue(ref),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {upsertDocuments: vi.fn().mockResolvedValue(undefined)};

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertFeatures).toHaveBeenCalledWith(
      ref,
      [
        {
          name: 'Control Crucero',
          description: 'Adaptativo',
          category: 'equipment',
        },
      ],
      page,
    );
  });
});
