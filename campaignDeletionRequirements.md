Requirements

1. When a campaign has ended and its been a week, delete all its data, but not the backlinks domain where we extracted an email or a form i.e if we found a way to contact them either of it, then that automatically means contacted as we feed it into another automation tool. 
2. Since, contacted we keep this in another table for that many days eg 90 or whatever was set and this way although campaign has ended and even deleted but the domains where we contacted(found either of email or contact form) those we save so that future campaigns don't spam on them and should only contact once the period has ended.
3. Also that small table where you'd be saving backlink domains and stuff should keep entries as per the expiry date only that we define in the team panel. 
4. In dashboard frozen snapshot should be accessible so one can atleast go thru if needed to check some details and export, retry should also disappear if its a campaign where we already deleted data.

Do proper testing of this without affecting existing prod data and then only confirm that ebverything has been done, take time and build it cleanly. 

In short all what I want is automatic deletion for campaign data should happen after a week but it shouldnt delete the data in those tables where we save contacted domains, backlinks and all that. do not contact, sites to monitor per member should also be kept as it is, dashboard should also show data for those campaigns in frozen snapshot and I believe export would fail and retry as well if no point then you can remove them. retry shouldn't be there for those as well.