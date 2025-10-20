/*
  Warnings:

  - A unique constraint covering the columns `[shopifyVariantId]` on the table `Variant` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shopifyInventoryItemId]` on the table `Variant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "shopifyDefaultLocationId" TEXT;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "shopifyInventoryItemId" TEXT,
ADD COLUMN     "shopifyVariantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Variant_shopifyVariantId_key" ON "Variant"("shopifyVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_shopifyInventoryItemId_key" ON "Variant"("shopifyInventoryItemId");
