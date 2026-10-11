# Reservation Policy

> SAMPLE DOCUMENT for the Allo demo. Replace with your own policies.

## Hold duration
A reservation holds stock for 15 minutes by default. Operators may request a longer
hold of up to 120 minutes for orders that need payment verification. Holds that are not
confirmed before they expire are released automatically and the stock becomes available again.

## Confirming a reservation
Confirm only after payment is captured. Confirming removes the units from on-hand stock
permanently, so a confirmation cannot be undone. An expired hold cannot be confirmed;
create a new reservation instead.

## Large orders
Any single reservation above 50 units requires approval from the regional operations
manager before it is confirmed. Do not split a large order into several small
reservations to avoid this approval.

## Retries
Always reuse the same idempotency key when retrying a failed request, so the same
order is never reserved twice.
