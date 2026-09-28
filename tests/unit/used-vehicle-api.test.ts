import {describe, expect, it} from 'vitest';
import {
  UsedVehicleInventoryClient,
  type UsedVehicleApiResponse,
} from '../../src/crawl/used-vehicle-api.js';

describe('UsedVehicleInventoryClient', () => {
  it('normalizes the read-only inventory response into typed records', async () => {
    const response: UsedVehicleApiResponse = {
      LiAutos: [
        {
          AutId: '502969',
          Marca: 'Ford',
          Modelo: 'Escape',
          Version: 'Trend Advance Ecoboost',
          Precio: '360000.0000',
          Kilometraje: '57643',
          Transmision: 'Automática',
          RegAuto: '161',
          Directorio: 'uruapan',
          UrlDist: 'www.forduruapan.mx',
          ClaveMarca: 'FO',
          PathWZ: 'images/FO/502969.jpg',
          Extension: '.jpg',
        },
      ],
    };
    const client = new UsedVehicleInventoryClient(
      async () => response,
      'https://www.forduruapan.mx/Seminuevos/',
    );

    await expect(client.fetch()).resolves.toEqual([
      {
        inventoryId: '502969',
        title: 'Ford Escape Trend Advance Ecoboost',
        price: 360000,
        currency: 'MXN',
        mileageKm: 57643,
        transmission: 'automatic',
        imageUrls: [
          'https://www.forduruapan.mx/SeminuevosMotorV3/BuscaFoto/BF2.ashx?AutoID=502969&tumb=0&numFoto=0&id=161&dir=uruapan&url=www.forduruapan.mx&mar=FO&pwz=images%2FFO%2F502969.jpg&ext=.jpg',
        ],
        detailUrl: 'https://www.forduruapan.mx/Seminuevos/502969',
        sourceUrl: 'https://www.forduruapan.mx/Seminuevos/',
        metadata: {extraction: 'seminuevos-checkdist'},
      },
    ]);
  });
});
