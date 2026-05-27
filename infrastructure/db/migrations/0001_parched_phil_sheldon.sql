ALTER TABLE "mentions" ALTER COLUMN "sentiment_score" SET DATA TYPE numeric(4, 3) USING "sentiment_score"::numeric(4, 3);
