-- CreateTable
CREATE TABLE "saved_address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_address_userId_idx" ON "saved_address"("userId");

-- AddForeignKey
ALTER TABLE "saved_address" ADD CONSTRAINT "saved_address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
