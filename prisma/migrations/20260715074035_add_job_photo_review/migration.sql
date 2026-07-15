-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('assigned', 'started', 'completed', 'in_review', 'released', 'paid', 'disputed', 'refunded');

-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('before', 'after');

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'assigned',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "reviewDeadline" TIMESTAMP(3),
    "amount" INTEGER,
    "platformFee" INTEGER,
    "stripePaymentIntentId" TEXT,
    "stripeTransferId" TEXT,
    "chargedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_photo" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "PhotoType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_bookingId_idx" ON "job"("bookingId");

-- CreateIndex
CREATE INDEX "job_agentId_idx" ON "job"("agentId");

-- CreateIndex
CREATE INDEX "job_status_idx" ON "job"("status");

-- CreateIndex
CREATE INDEX "job_photo_jobId_idx" ON "job_photo"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "review_jobId_key" ON "review"("jobId");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
