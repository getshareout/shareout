# E-commerce and Analytics Glossary

Shared definitions for the e-commerce and analytics teams at Acme Digital. Use them in audits, dashboards and client reports so the same word means the same number across every account. Paid media and funnel metrics are defined in the Spanish "Glosario de métricas de marketing". Owner: Julieta Montes (Data and Analytics), with Diego Salvatierra (Head of E-commerce).

## Cart abandonment rate

Share of shopping carts that are created but never turn into a completed order.
Formula: 1 - (completed orders / carts created).
Example: 2,000 carts and 560 orders give an abandonment rate of 72%. We flag it to the client when it stays above 80% for a full week.

## Average order value (AOV)

Average revenue per order, excluding shipping and taxes but after discounts.
Formula: revenue / number of orders.
Example: USD 54,000 in revenue from 900 orders gives an AOV of USD 60.

## Gross merchandise value (GMV)

Total value of the goods sold at list price, before discounts, returns, cancellations and shipping. Useful to size a store or a marketplace channel, but never use it as revenue in a report.
Example: a month with a GMV of USD 120,000 can end with USD 98,500 of net revenue.

## RFM segmentation

Groups customers by Recency (days since last purchase), Frequency (number of orders) and Monetary value (total spent). Each dimension gets a score from 1 to 5 by quintile, so the best customers are 5-5-5 ("champions"). We refresh the segments monthly from the store's order export and use them for email and remarketing audiences.

## Cohort retention

Share of the customers acquired in a given month who buy again in later months.
Example: of 1,000 customers acquired in January, 180 bought again by the end of April, so month-3 retention is 18%. Always compare cohorts of the same length and season.

## Attribution window

The period after an ad click or view during which a conversion is credited to that ad. Our default is 7-day click and 1-day view in Meta Ads and 30-day click in Google Ads. Always state the window in a footnote, because changing it changes the results.

## Incrementality test

An experiment that compares a group exposed to the ads with a holdout group that does not see them, to measure the sales the ads actually caused. We use geographic or audience holdouts of 10% to 20% for at least 4 weeks, and only with a test budget of USD 10,000 or more.
Lift formula: (test conversion rate - holdout conversion rate) / holdout conversion rate.

## Marketing efficiency ratio (MER)

Total revenue divided by total marketing spend across all channels, including agency fees and tools. It ignores attribution, so it is the sanity check for platform-reported results.
Example: USD 250,000 in revenue and USD 50,000 in total marketing spend give a MER of 5.0.

## Contribution margin

What an order leaves after paying for everything it consumed: revenue minus all variable costs of that order (product cost, shipping, payment fees and the marketing spent to get it).
Example: an order of USD 80 with USD 36 of product cost, USD 7 of shipping, USD 3 of payment fees and USD 14 of marketing leaves USD 20, a contribution margin of 25%.

## Fill rate

Share of ordered units that ship complete from stock in the first shipment.
Formula: units shipped on first shipment / units ordered.
Example: 4,750 of 5,000 units gives a fill rate of 95%. Our logistics partner, Wide World Logística, reports it weekly; below 92% we review the stock sync.

## Sell-through rate

Share of the inventory received that was sold in a period.
Formula: units sold / units received.
Example: 600 units sold out of 800 received in 30 days is a sell-through rate of 75%. Products below 40% after 60 days become candidates for a markdown.

## Bounce rate

In GA4, the percentage of sessions that were not engaged. A session counts as engaged when it lasted 10 seconds or longer, had a conversion event or had at least 2 page views.
Formula: 1 - engagement rate.
Example: 10,000 sessions with 6,200 engaged sessions give a bounce rate of 38%.

## Sessions vs. users

Users are the unique people (devices or logged-in IDs) who visited the site; sessions are their visits. One user can have many sessions, and a GA4 session ends after 30 minutes of inactivity.
Example: 8,000 users who generated 11,500 sessions average 1.44 sessions per user. Never add up users across days or channels.
