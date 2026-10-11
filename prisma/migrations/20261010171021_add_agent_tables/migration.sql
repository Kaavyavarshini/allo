-- CreateTable
CREATE TABLE "ToolCallLog" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "args" JSONB,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyChunk" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedder" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolCallLog_createdAt_idx" ON "ToolCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ToolCallLog_tool_createdAt_idx" ON "ToolCallLog"("tool", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyChunk_embedder_idx" ON "PolicyChunk"("embedder");
