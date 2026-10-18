-- Phase 5.2: at most one non-void quotation per customer request (audit trail keeps void rows).
CREATE UNIQUE INDEX idx_quotations_one_active_per_request
  ON quotations (customer_request_id)
  WHERE customer_request_id IS NOT NULL AND status != 'void';
