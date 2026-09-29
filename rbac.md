We need to implement rbac in guestpostlinksvmvp

1. 2 roles will be there admin and something like a worker(don't actually name it worker), admin will have access to everything in the app, simple
2. worker will be able to see only his campaigns, the ones he started and has access to it only. 
3. admin will have the right to invite anyone by their mail id.


I can come up with this only for now, if any new ideas or rights we shud implement let me know, but please start implementing rbac as the app needs to go live today and admin access, worker accesss needs to be there as accounts I'll be creating today and everyone will start using the app. 

Secondly, I believe we dont use playwright in the app not in the server but locally right to push numbers up? Now please wire playwright properly in code so playwright works in server as well, so that those retries we do in local after a campaign ends we need not do locally, data impulse also I'll add in server so make sure proxy + playwright + captcha(if needed genuinely all is wired). 
Kindly start implementing these, if any doubts ask me, dont assume and hallucinate, build cleanly and professionally. 

12. Email invite