import test from "node:test";
import assert from "node:assert/strict";
import { getLeadEligibility, type LeadSnapshot } from "../lib/followup.ts";

const eligibleLead: LeadSnapshot = {
  chatId: "test-chat",
  leadId: null,
  name: null,
  phone: "5521999999999",
  email: null,
  transferred: false,
  booked: false,
  appointmentId: null,
  followupAllowed: true,
  conversationStatus: "qualificado_followup",
  treatment: "Limpeza de pele",
  qualificationStatus: "qualificado_followup",
  location: null,
  appointmentType: null,
  lastAiMessageAt: null,
  createdAt: null,
};

test("permite interesse em tratamento sem confundir com tratamento em andamento", () => {
  assert.equal(getLeadEligibility(eligibleLead).eligible, true);
});

test("bloqueia agendamento mesmo com a flag agendado desatualizada", () => {
  for (const change of [
    { appointmentId: "appointment-1" },
    { conversationStatus: "Agendado" },
    { conversationStatus: "agendado_protocolo" },
    { qualificationStatus: "qualificado_agendado" },
  ]) {
    assert.deepEqual(getLeadEligibility({ ...eligibleLead, ...change }), {
      eligible: false,
      reason: "Lead já agendado",
    });
  }
});

test("bloqueia atendimento encerrado, desqualificado, humano ou em tratamento", () => {
  for (const status of ["Encerrada", "encerrado", "finalizado", "concluída", "desqualificado", "encaminhado_humano", "em_tratamento"]) {
    assert.equal(getLeadEligibility({ ...eligibleLead, conversationStatus: status }).eligible, false, status);
  }
  assert.equal(getLeadEligibility({ ...eligibleLead, qualificationStatus: "desqualificado" }).eligible, false);
});

test("não confunde follow-up para agendar com consulta já agendada", () => {
  assert.equal(getLeadEligibility({ ...eligibleLead, conversationStatus: "followup_agendado_para_dia_10" }).eligible, true);
  assert.equal(getLeadEligibility({ ...eligibleLead, qualificationStatus: "qualificado_agendamento" }).eligible, true);
});
