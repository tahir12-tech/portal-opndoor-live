# Ask the developer

Open questions and handovers that block work on our side until someone else
answers or builds their half. Each item says who is waiting on whom.

## 1. The Lettings verdict handover (direct rail: referencing to sent)

A direct tenant applies, pays the eligibility fee and submits, which leaves the
application at `referencing`, awaiting the decision. Nothing in our code moves it
to `sent` automatically. That transition is the Lettings verdict, and it has two
halves. Say whose each is:

1. **Lettings sending the verdict to us. Balal's, on their side.** He needs to
   tell us the mechanism, and build whatever sends it.

2. **Receiving the verdict and setting the status. Ours.** We write it once he
   tells us the shape.

Until half 1 exists, approval is a manual staff act (the Approve action sets the
status to `sent` and sends the tenant the portal payment email). Half 2 replaces
the manual step with the automated receiver once the shape of half 1 is known.
