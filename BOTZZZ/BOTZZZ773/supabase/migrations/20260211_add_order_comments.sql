-- Add comments column for custom comment orders
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS comments TEXT;
