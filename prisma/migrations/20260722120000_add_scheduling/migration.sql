-- AlterTable
ALTER TABLE "job" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "visitNumber" INTEGER NOT NULL DEFAULT 1;

-- Backfill: the existing lone Job per booking becomes visit #1, dated from the
-- customer-chosen booking.scheduleDate. visitNumber already defaulted to 1 for
-- every existing row, so only the date needs filling.
UPDATE "job" j
SET "scheduledDate" = b."scheduleDate"
FROM "booking" b
WHERE j."bookingId" = b."id" AND j."scheduledDate" IS NULL;

-- CreateTable
CREATE TABLE "employee" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_agentId_idx" ON "employee"("agentId");

-- CreateIndex
CREATE INDEX "job_employeeId_scheduledDate_idx" ON "job"("employeeId", "scheduledDate");

-- CreateIndex
CREATE INDEX "job_scheduledDate_idx" ON "job"("scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "job_bookingId_visitNumber_key" ON "job"("bookingId", "visitNumber");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
