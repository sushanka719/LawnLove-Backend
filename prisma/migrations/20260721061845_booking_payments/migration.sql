-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('pendingPayment', 'active', 'pastDue', 'cancelled', 'completed');
ALTER TABLE "public"."booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "public"."BookingStatus_old";
ALTER TABLE "booking" ALTER COLUMN "status" SET DEFAULT 'pendingPayment';
COMMIT;

-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "amountCharged" INTEGER,
ADD COLUMN     "areaSurcharge" INTEGER NOT NULL,
ADD COLUMN     "basePrice" INTEGER NOT NULL,
ADD COLUMN     "planId" TEXT NOT NULL,
ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ALTER COLUMN "stripePaymentMethodId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'pendingPayment';

-- AlterTable
ALTER TABLE "job" ADD COLUMN     "agentPaidAt" TIMESTAMP(3),
ADD COLUMN     "agentPayoutAmount" INTEGER,
ADD COLUMN     "agentPayoutRef" TEXT;

-- CreateIndex
CREATE INDEX "booking_planId_idx" ON "booking"("planId");

-- CreateIndex
CREATE INDEX "booking_stripeSubscriptionId_idx" ON "booking"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
