import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

describe('MailService.sendNotice', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const service = new MailService({ sendMail } as unknown as MailerService);

  beforeEach(() => sendMail.mockClear());

  const sent = () => (sendMail.mock.calls[0] as [Record<string, string>])[0];

  it('escapes staff-typed text in the HTML and keeps it plain in the text', async () => {
    const reason = `<script>alert("x")</script> & 'quotes'`;

    await service.sendNotice('ama@example.com', {
      subject: 'Your account has been suspended',
      title: `Suspended <b>now</b>`,
      paragraphs: [`Reason: ${reason}`],
    });

    const mail = sent();
    expect(mail.to).toBe('ama@example.com');
    expect(mail.subject).toBe('Your account has been suspended');
    expect(mail.html).toContain(
      'Reason: &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;',
    );
    expect(mail.html).toContain('Suspended &lt;b&gt;now&lt;/b&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>now</b>');
    expect(mail.text).toBe(`Suspended <b>now</b>\n\nReason: ${reason}`);
  });

  it('gives each paragraph its own block', async () => {
    await service.sendNotice('ama@example.com', {
      subject: 's',
      title: 't',
      paragraphs: ['one', 'two'],
    });

    expect(sent().html).toContain(
      '<p class="text">one</p><p class="text">two</p>',
    );
  });

  it('rethrows a delivery failure for the caller to handle', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      service.sendNotice('ama@example.com', {
        subject: 's',
        title: 't',
        paragraphs: [],
      }),
    ).rejects.toThrow('SMTP down');
  });
});
