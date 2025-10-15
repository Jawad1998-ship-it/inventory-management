import { prisma } from '../lib/prisma.js';

export async function computeATS(variantId: string) {
  // Available-To-Sell = on_hand - reserved + incoming - safety_buffer
  const level = await prisma.inventoryLevel.aggregate({
    _sum: { onHand: true, reserved: true, incoming: true, safetyBuffer: true },
    where: { variantId },
  });
  const onHand = level._sum.onHand ?? 0;
  const reserved = level._sum.reserved ?? 0;
  const incoming = level._sum.incoming ?? 0;
  const buffer = level._sum.safetyBuffer ?? 0;
  return Math.max(onHand - reserved + incoming - buffer, 0);
}

export async function reserveStock(opts: { variantId: string; quantity: number; source: string; orderId?: string }) {
  const { variantId, quantity, source, orderId } = opts;
  return prisma.$transaction(async (tx) => {
    const ats = await computeATS(variantId);
    if (ats < quantity) {
      throw new Error('INSUFFICIENT_ATS');
    }
    const reservation = await tx.reservation.create({
      data: { variantId, quantity, source, orderId, status: 'ACTIVE' },
    });
    await tx.inventoryLevel.updateMany({
      where: { variantId },
      data: { reserved: { increment: quantity } },
    });
    await tx.stockMovement.create({
      data: { variantId, type: 'RESERVATION', quantity, notes: source },
    });
    return reservation;
  });
}
