-- CreateEnum
CREATE TYPE "BookingFrequency" AS ENUM ('weekly', 'biweekly', 'monthly', 'oneTime');

-- CreateEnum
CREATE TYPE "BookingTimeSlot" AS ENUM ('morning', 'midday', 'afternoon', 'evening');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('scheduled', 'cancelled', 'completed');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "boundary" JSONB NOT NULL,
    "areaSqFt" INTEGER NOT NULL,
    "estimatedAreaSqFt" INTEGER NOT NULL,
    "frequency" "BookingFrequency" NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discountPct" DOUBLE PRECISION NOT NULL,
    "totalPerVisit" INTEGER NOT NULL,
    "scheduleDate" TIMESTAMP(3) NOT NULL,
    "timeSlot" "BookingTimeSlot" NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_userId_idx" ON "booking"("userId");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
