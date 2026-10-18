# Grocery app: cart

## Goal
Let shoppers review what they picked, fix mistakes and reach checkout in under ten seconds, with the delivery cost visible before they commit.

## Users
- Busy parents ordering a weekly shop on a phone, often one-handed.
- Occasional shoppers who top up a few items and want the final price early.

## Screens
### Cart
Item rows with image, name, price and a quantity stepper. Promo code field, order summary (items, delivery, total) and a primary Check out button pinned at the bottom.

### Empty cart
Friendly message, one primary action to browse products, and a short list of previously bought items.

## States
- Cart: default, updating quantity, invalid promo code, payment failed.
- Empty cart: default, signed out.

## Assumptions
- Mobile first at 390 x 844, desktop follows later.
- Delivery fee is known before checkout.
- One promo code per order.
- Uses the existing grocery design system: Button, Input, List item, Stepper.
