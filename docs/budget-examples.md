# Budget calculation examples

All values below are synthetic USD. These examples implement the [accepted rules](decisions/2026-11-04-envelope-budget-rules.md). The public domain contracts use integer cents. A result can show a deficit; an assignment write must also check the application deficit rule.

## Cash and months

Opening Cash is $1,000, Food Available is $100, and Ready to Assign is $900. The opening difference is zero. An opening Ready to Assign of $800 instead has an unexplained difference of $100 and is refused.

October assignment of $200 and Cash spending of $60 give Food Available $240 and Ready to Assign $700. November assignment of $50 gives Food carry-in $240, Available $290, and Ready to Assign $650. Each assignment applies once. If November is funded while viewing October, future commitments show $50 separately.

From Food $100 and Ready to Assign $900, Cash spending of $150 gives Food -$50 and Cash overspending $50. November Food starts at zero and Ready to Assign is $850. Credit spending of $150 instead gives reserve $100 and unfunded Credit spending $50. November Food starts at zero, reserve remains $100, and Ready to Assign remains $900.

A $30 Cash income increases Ready to Assign by $30. A $20 category refund increases Food by $20. An unallocated $10 Cash outflow changes held funds and makes this and later reports incomplete until allocation is supplied.

An assignment of $950 in January, viewed with October Ready to Assign $900, shows future commitments $950 and deficit $50. A correction that reduces October funds must recalculate that deficit. A write cannot create or increase it. Returning funds can reduce it.

With Ready to Assign $100, November assignment $200, and December return of $100, October commitments are $200 and its funding deficit is $100. November Ready to Assign is -$100 and its deficit remains $100. December reaches zero. The December return cannot fund November.

Before November activation, October Cash $1,000, Food $100, and Ready to Assign $900 followed by $150 Cash spending leave Cash $850 and October Food -$50. The reviewed November opening is Cash $850, Food $0, and Ready to Assign $850. Do not seed Food -$50 and deduct that deficit again at the next rollover.

If the $150 spending was on Credit, November Cash remains $1,000, Food opens at $0, reserve is $100, Ready to Assign is $900, and card debt is $150 with shortfall $50. Thus the same imported Food -$50 needs different resolved values for Cash and Credit spending. The opening facts cannot infer that history. Negative ordinary opening Food is refused; a reviewed negative card reserve remains visible.

## Cards

With Food $100, a funded card purchase of $60 gives Food $40, card debt $60, and reserve $60. A payment of $60 gives reserve zero and debt zero, with no second expense. Existing opening debt creates no reserve; assign funds directly to the payment category to cover it.

With positive card balance $50 and Food $100, a $70 purchase gives card debt $20, Food $30, and reserve $20. The first $50 uses positive held funds and has cash priority. Include the positive $50 in the opening held-funds equation.

With Food $100, Cash spending $30, card A spending $80, and card B spending $80, Food is -$90. Cash overspending is zero. Reserve A is $70; reserve B is zero. Unfunded Credit spending is $90. Account IDs A then B control funding, even if B's event comes first. A later same-month assignment of $90 funds both reserves fully. Reverse event input order and obtain the same report.

A $10 interest charge is category spending under the same card rule. A $30 uncategorized debt-reducing statement credit against $100 debt leaves debt $70 and does not increase Ready to Assign. Once a statement credit creates a positive card balance, only that positive increase supplies new held funds.

## Refunds

Start a card at positive $50, spend $70 from Food $100, then refund $70 next month. Food returns to $100, card returns to positive $50, and reserve returns to zero. Ready to Assign returns to its opening value. The $20 debt part reverses its reserve; the $50 positive-balance part does not create a false reserve deficit. For a partial refund, match known debt purchase amounts before known positive-balance purchase amounts. An unmatched refund is treated as debt-related opening history.

Buy $60 from Food $100, then refund $20 in the same month before payment: Food $60, debt $40, reserve $40. Net activity determines funding.

Buy $60, pay $60, then refund $60 next month. With initial Cash $1,000, Food $100, and Ready to Assign $900, the final Cash is $940, positive card funds are $60, held funds are $1,000, Food is $100, reserve is -$60, and Ready to Assign is $960. The reserve deficit is visible. The $60 Ready to Assign increase comes from positive card held funds, not debt reduction.

A net category refund of $20 on card A can fund a $20 purchase on card B in the same month. Starting Food at zero, Food ends at zero, A reserve falls $20, and B reserve rises $20. Cash has first claim: replace B's purchase with $30 Cash spending and Food ends -$10, with Cash overspending $10.

## Transfers and conservation

A $100 Cash/Cash transfer changes neither combined held funds nor envelopes. A Cash/Tracking outflow spends its category once; an inflow is explicit income or a category refund. Tracking snapshots do not change.

Opening Cash $100, card debt $50, reserve $70, and Ready to Assign $30 satisfy the opening equation. Pay $70: Cash becomes $30, card balance becomes positive $20, reserve becomes zero, and held funds become $50. Ready to Assign becomes $50. The $20 increase offsets reserve funds that are now held on the card. No income event is added.

Credit/Cash advances, Credit/Credit transfers, Credit/Tracking, Tracking/Tracking, self-transfers, and unmatched source effects are refused. An earlier activation that needs such an unsupported event cannot omit it.

## Dates, splits, and evidence

October 31 and November 1 are different budget months, even if both entries post in November. December carries into January by the same rules. Same-day events use saved order and event ID. Database insertion order is not used.

A parent -$1.00 can split into -$2.00 and +$1.00 on different categories. The signed sum must match exactly. Duplicate category lines must be combined. On a positive card, negative split lines use positive card funds in category ID order.

The application must review an earlier boundary balance and every bridge to a later register opening. A history source linked to a live row is counted once. An old pending entry needs an explicit included-in-opening or later-effect choice. These evidence checks do not change existing account openings or source rows.

With card +$50, split A -$70 and B +$60 has net parent -$10. Gross A spending uses $50 positive funds and creates $20 debt spending. The unmatched B refund reverses $60 of reserve. Net reserve movement is -$40; card ends +$40. Ready to Assign rises $40 to preserve held funds. A and B activity remain -$70 and +$60. Reversing split input lines does not change the result.
