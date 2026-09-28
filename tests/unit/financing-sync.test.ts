import {describe, expect, it, vi} from 'vitest';
import {FinancingSyncService} from '../../src/finance/financing-sync.js';
import type {StoredPage} from '../../src/domain/contracts.js';

const financingPage: StoredPage = {
  id: 42,
  url: 'https://www.forduruapan.mx/Financiamiento/',
  canonicalUrl: 'https://www.forduruapan.mx/Financiamiento/',
  pageType: 'financing',
  title: 'Financing',
  rawHtml: '<main>Financing</main>',
  extractedText: 'Financing',
  contentHash: 'finance-page',
  metadata: {},
};

describe('FinancingSyncService', () => {
  it('fetches active financing data and persists searchable offer documents', async () => {
    const client = {
      loadBootstrap: vi.fn().mockResolvedValue({
        dealerId: 'dealer',
        vehicles: [
          {modelName: 'Territory', modelYear: 2026, vehicleKey: 'TERR26'},
        ],
      }),
      getActiveVehicleKeys: vi.fn().mockResolvedValue(['TERR26']),
      getVersionsByVehicleKey: vi.fn().mockResolvedValue({
        Versiones: [
          {
            modeloJato: 'Territory',
            anio: '26',
            VersionJato: 'Titanium',
            precioLista: 789900,
            IDClaveVersion: 'VERSION-1',
          },
        ],
      }),
      getPlansByVersion: vi.fn().mockResolvedValue({
        Planes: [{plaID: 1, plaNombre: '24 meses sin intereses', plaIva1: 16}],
        Plazos: [{plaid: 1, tasa: 0, EngancheMin: 20, plazo: 24}],
      }),
    };
    const offers = {
      upsertOffer: vi.fn().mockResolvedValue({offerId: 'offer-1'}),
    };
    const documents = {
      upsertOfferDocument: vi.fn().mockResolvedValue(undefined),
    };

    const service = new FinancingSyncService(client, offers, documents);
    const summary = await service.sync(financingPage);

    expect(summary).toEqual({activeVehicles: 1, versions: 1, offers: 1});
    expect(offers.upsertOffer).toHaveBeenCalledOnce();
    expect(documents.upsertOfferDocument).toHaveBeenCalledWith(
      {offerId: 'offer-1'},
      expect.objectContaining({
        documentType: 'offer',
        title: 'Ford Territory 2026 — Territory Titanium - 24-month financing',
      }),
      42,
    );
  });
});
