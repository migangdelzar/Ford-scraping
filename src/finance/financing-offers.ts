import type {OfferCandidate} from '../domain/contracts.js';
import type {
  ActiveVersionResponse,
  FinanceVehicleReference,
  FinancingPlanResponse,
} from './ford-finance-client.js';

export interface FinancingOfferInput {
  sourceUrl: string;
  vehicles: FinanceVehicleReference[];
  versionsByVehicleKey: Map<string, ActiveVersionResponse>;
  plansByVersionId: Map<string, FinancingPlanResponse>;
}

export function normalizeFinancingOffers(
  input: FinancingOfferInput,
): OfferCandidate[] {
  const vehicleByKey = new Map(
    input.vehicles.map(vehicle => [vehicle.vehicleKey, vehicle]),
  );
  const offers: OfferCandidate[] = [];

  for (const [vehicleKey, versionResponse] of input.versionsByVehicleKey) {
    const vehicleReference = vehicleByKey.get(vehicleKey);
    for (const version of versionResponse.Versiones ?? []) {
      const versionId = asString(version.IDClaveVersion);
      const price = asNumber(version.precioLista);
      if (!versionId || price === undefined) continue;

      const modelName =
        asString(version.modeloJato) ?? vehicleReference?.modelName;
      const modelYear =
        parseModelYear(version.anio) ?? vehicleReference?.modelYear;
      const versionName = asString(version.VersionJato) ?? 'Vehicle version';
      const financingResponse = input.plansByVersionId.get(versionId);
      if (!financingResponse || !modelName || modelYear === undefined) continue;

      for (const plan of financingResponse.Planes ?? []) {
        const planId = asString(plan.plaID);
        const planName = asString(plan.plaNombre);
        if (!planId || !planName) continue;

        for (const term of financingResponse.Plazos ?? []) {
          if (asString(term.plaid) !== planId) continue;
          const termMonths = asNumber(term.plazo);
          const downPaymentPercent = asNumber(term.EngancheMin);
          const annualInterestRate = asNumber(term.tasa);
          if (
            termMonths === undefined ||
            downPaymentPercent === undefined ||
            annualInterestRate === undefined
          )
            continue;

          const message = financingResponse.Mensaje?.map(item =>
            asString(item.Mensaje),
          )
            .filter((value): value is string => Boolean(value))
            .join(' ');
          const monthsWithoutInterest = extractInterestFreeMonths(planName);
          const labelMonths = extractPlanMonths(planName);
          const termConflict =
            labelMonths !== undefined && labelMonths !== termMonths
              ? {labelMonths, structuredMonths: termMonths}
              : undefined;
          const lifeInsurance =
            asNumber(financingResponse.Seguros?.[0]?.Precio) ?? 0;
          const taxRate = asNumber(plan.plaIva1) ?? 0;
          const externalKey = [vehicleKey, versionId, planId, termMonths].join(
            ':',
          );
          offers.push({
            modelName,
            modelYear,
            title: `${modelName} ${versionName} - ${termMonths}-month financing`,
            description: planName,
            offerType: monthsWithoutInterest
              ? 'months_without_interest'
              : 'financing',
            cashPrice: price,
            downPaymentAmount: roundMoney((price * downPaymentPercent) / 100),
            downPaymentPercent,
            monthlyPayment: calculateMonthlyPayment({
              price,
              downPaymentPercent,
              termMonths,
              annualInterestRate,
              taxRate,
              lifeInsurance,
            }),
            termMonths,
            monthsWithoutInterest,
            annualInterestRate,
            currency: 'MXN',
            requiresCreditApproval: true,
            conditions: message,
            sourceUrl: input.sourceUrl,
            metadata: {
              extraction: 'financing-api',
              vehicleKey,
              versionId,
              planId,
              termMonths,
              externalKey,
              sourceVersionName: versionName,
              sourcePlanName: planName,
              termConflict,
              bonusAmount: asNumber(plan.plaBono),
              taxRate: asNumber(plan.plaIva1),
              openingCommissionRate: asNumber(plan.plaInv),
              maximumDownPaymentPercent: asNumber(plan.plaEngMax),
              monthlyPaymentSource: 'calculated-from-ford-ui-formula',
              lifeInsurance,
              sourceTerm: term,
            },
          });
        }
      }
    }
  }

  return offers;
}

function extractPlanMonths(value: string): number | undefined {
  const match = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/(\d+)\s+meses?/i);
  return match ? Number(match[1]) : undefined;
}

function extractInterestFreeMonths(value: string): number | undefined {
  const match = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/(\d+)\s+meses?\s+sin\s+interes/i);
  return match ? Number(match[1]) : undefined;
}

function parseModelYear(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed)) return undefined;
  return parsed < 100 ? 2000 + parsed : parsed;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replaceAll(',', '').replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateMonthlyPayment(input: {
  price: number;
  downPaymentPercent: number;
  termMonths: number;
  annualInterestRate: number;
  taxRate: number;
  lifeInsurance: number;
}): number {
  const downPayment = (input.price * input.downPaymentPercent) / 100;
  let balance = input.price - downPayment + input.lifeInsurance;
  const monthlyInterestFactor =
    ((input.annualInterestRate / 100) * (1 + input.taxRate / 100)) / 12;
  let payment = (balance + balance * monthlyInterestFactor) / input.termMonths;
  let total = payment;

  for (let month = 2; month <= input.termMonths; month += 1) {
    balance = balance + balance * monthlyInterestFactor - payment;
    payment =
      (balance + balance * monthlyInterestFactor) /
      (input.termMonths - month + 1);
    total += payment;
  }

  return roundMoney(total / input.termMonths);
}
