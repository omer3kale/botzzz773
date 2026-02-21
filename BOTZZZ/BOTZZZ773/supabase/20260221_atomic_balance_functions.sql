-- Atomic balance deduction function to prevent race conditions
-- Instead of read-then-write (which loses updates under concurrency),
-- this does a single atomic UPDATE ... SET balance = balance - amount WHERE balance >= amount
-- Returns the new balance or raises an error if insufficient funds

CREATE OR REPLACE FUNCTION deduct_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE users
  SET balance = balance - p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
    AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Atomic balance refund function (adds amount back)
CREATE OR REPLACE FUNCTION refund_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE users
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  RETURN v_new_balance;
END;
$$;
