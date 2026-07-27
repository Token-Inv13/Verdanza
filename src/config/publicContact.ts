export const verdanzaPublicContact = {
  displayPhone: "07 80 81 41 37",
  internationalPhone: "+33780814137",
  phoneHref: "tel:+33780814137",
  smsMessage: "Bonjour Verdanza, j’ai une question concernant…",
  contactPath: "/contact",
};

export const verdanzaSmsHref = `sms:${verdanzaPublicContact.internationalPhone}?body=${encodeURIComponent(
  verdanzaPublicContact.smsMessage,
)}`;
